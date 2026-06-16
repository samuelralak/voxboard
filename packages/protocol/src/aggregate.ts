/**
 * Board aggregation: derive per-idea stats (score, status, reply count, pinned) and the board's
 * moderation sets from a flat list of the board's events. Pure and deterministic, so the aggregator
 * (Durable Object) and any client share one implementation and can never disagree. Zaps are added in
 * M4. See docs/INDEXER.md / PROTOCOL.md.
 */

import { KIND, MODERATION_MODE, type Status } from "./kinds";
import type { NostrEvent } from "./event";
import { parseBoard, type Board } from "./board";
import type { Idea } from "./idea";
import type { Reply } from "./reply";
import { partitionBoardEvents, replyCountsByRoot } from "./thread";
import { parseVote, tallyVotesByTarget, type VoteTally } from "./vote";
import { deletedEventIds, parseDelete } from "./delete";
import { parseStatus, type StatusLabel } from "./status";
import { approvedPostIds, parseApproval } from "./approval";
import {
  bannedSubjects,
  collapseStatuses,
  hiddenTargets,
  isAuthorized,
  lockCutoffs,
  parseBan,
  parseHide,
  parseLock,
  parsePin,
  pinnedTargets,
} from "./moderation";

export interface IdeaStat {
  id: string;
  title: string;
  body: string;
  author: string;
  createdAt: number;
  categories: string[];
  score: number;
  up: number;
  down: number;
  replyCount: number;
  status: Status | null;
  pinned: boolean;
  /** true unless the board is curated and this idea has no authorized approval (and the author is not a mod) */
  approved: boolean;
}

export type IdeaSort = "top" | "trending" | "new";

export interface BoardAggregate {
  board: Board | null;
  ideas: IdeaStat[];
  /** pubkeys banned by the owner/mods */
  banned: Set<string>;
  /** ids of ideas/replies hidden by the owner/mods */
  hidden: Set<string>;
}

/**
 * One idea with everything a client renderer needs: the full parsed Idea plus its complete VoteTally
 * (INCLUDING byPubkey, which IdeaStat drops). A SUPERSET of an IdeaStat row.
 */
export interface IdeaView {
  idea: Idea;
  tally: VoteTally;
  status: Status | null;
  replyCount: number;
  pinned: boolean;
  /** true unless the board is curated and this idea has no authorized approval (and the author is not a mod) */
  approved: boolean;
}

/**
 * The full read-time view of a board: a SUPERSET of BoardAggregate. The web client renders from this and
 * the indexer projects it down to IdeaStat[] via deriveBoardStats, so the two share ONE implementation of
 * deletions / moderation / trust and can never disagree (non-zap fields; zaps + Web-of-Trust stay
 * client-only overlays outside this pure function). All the per-target sets/maps the client needs
 * (byPubkey tallies, the replies array, locks, pins, pending) are exposed here, not recomputed downstream.
 */
export interface BoardView {
  board: Board | null;
  /** every non-deleted idea (hidden/banned/unapproved are NOT removed here — visibleIdeas filters them) */
  ideas: IdeaView[];
  /** non-deleted, non-hidden, non-banned replies (the basis for reply counts and the thread) */
  replies: Reply[];
  /** every target's deduped VoteTally, keyed by target id (ideas AND replies) */
  tallies: Map<string, VoteTally>;
  deleted: Set<string>;
  hidden: Set<string>;
  banned: Set<string>;
  /** per-idea lock cutoff (replies after it are dropped from counts/threads) */
  locks: Map<string, number>;
  pins: Set<string>;
  /** curated boards only: non-deleted/-hidden/-banned ideas still awaiting an authorized approval */
  pending: Idea[];
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

/** Shared read-only empty tally for ideas with no votes (never mutated; callers only read it). */
const EMPTY_TALLY: VoteTally = { up: 0, down: 0, score: 0, byPubkey: new Map() };

/**
 * Derive the full read-time board view from the board's events (community def, ideas/replies, votes,
 * labels, approvals, deletions). Pure and deterministic. This is the single source of truth for read-time
 * trust; deriveBoardStats is a projection of it.
 */
export function deriveBoardView(events: NostrEvent[]): BoardView {
  const boardEvents = events.filter((e) => e.kind === KIND.Community);
  const commentEvents = events.filter((e) => e.kind === KIND.Comment);
  const reactionEvents = events.filter((e) => e.kind === KIND.Reaction);
  const labelEvents = events.filter((e) => e.kind === KIND.Label);

  // Honor NIP-09 retractions before aggregating, so the indexer agrees with the client read path: an
  // author deleting their idea/reply/vote/label/board removes it (the same-author rule is enforced by
  // deletedEventIds). Without this, deleted content lingers and retracted votes keep inflating scores.
  const deletions = events.filter((e) => e.kind === KIND.Delete).map(parseDelete).filter(notNull);
  const deleted = deletedEventIds(deletions, [
    ...commentEvents,
    ...reactionEvents,
    ...labelEvents,
    ...boardEvents,
  ]);

  // Latest non-deleted board version wins; on equal created_at the lowest id breaks the tie (NIP-01),
  // so the indexer (SQLite scan order) and a client (relay arrival order) never pick opposite versions.
  const liveBoards = boardEvents
    .filter((e) => !deleted.has(e.id))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const board = liveBoards[0] ? parseBoard(liveBoards[0]) : null;

  // Moderation sets (only labels authored by the owner/mods count; collapse to latest per target).
  const labels = labelEvents.filter((e) => !deleted.has(e.id));
  const statuses: Map<string, StatusLabel> = board
    ? collapseStatuses(labels.map(parseStatus).filter(notNull), board)
    : new Map();
  const pins = board ? pinnedTargets(labels.map(parsePin).filter(notNull), board) : new Set<string>();
  const hidden = board ? hiddenTargets(labels.map(parseHide).filter(notNull), board) : new Set<string>();
  const banned = board ? bannedSubjects(labels.map(parseBan).filter(notNull), board) : new Set<string>();
  const locks = board ? lockCutoffs(labels.map(parseLock).filter(notNull), board) : new Map<string, number>();
  const approved = board
    ? approvedPostIds(
        events.filter((e) => e.kind === KIND.PostApproval && !deleted.has(e.id)).map(parseApproval).filter(notNull),
        board,
      )
    : new Set<string>();
  const curated = board?.mode === MODERATION_MODE.curated;

  const partitioned = partitionBoardEvents(commentEvents);
  const ideas = partitioned.ideas.filter((idea) => !deleted.has(idea.id));
  // A banned author's votes and replies must not count toward anyone's score / reply totals, and
  // hidden replies are excluded from the count too (mirrors how hidden/banned ideas drop in visibleIdeas).
  const replies = partitioned.replies.filter(
    (reply) => !deleted.has(reply.id) && !hidden.has(reply.id) && !banned.has(reply.pubkey),
  );
  const tallies = tallyVotesByTarget(
    reactionEvents
      .map(parseVote)
      .filter(notNull)
      .filter((vote) => !deleted.has(vote.id) && !banned.has(vote.pubkey)),
  );

  // One O(ideas + replies) pass for all reply counts; locks drop replies past each idea's cutoff.
  const replyCounts = replyCountsByRoot(ideas.map((idea) => idea.id), replies, locks);

  const isApproved = (idea: Idea) =>
    !curated || !board ? true : approved.has(idea.id) || isAuthorized(idea.pubkey, board);

  const ideaViews: IdeaView[] = ideas.map((idea) => ({
    idea,
    tally: tallies.get(idea.id) ?? EMPTY_TALLY,
    status: statuses.get(idea.id)?.state ?? null,
    replyCount: replyCounts.get(idea.id) ?? 0,
    pinned: pins.has(idea.id),
    // open boards: everything is approved. Curated: needs an authorized approval, but an idea posted
    // by the owner/a moderator is implicitly approved (they would just approve themselves otherwise).
    approved: isApproved(idea),
  }));

  // Curated boards: ideas that clear the basic gates (not deleted/hidden/banned) but have no authorized
  // approval yet. `ideas` is already deleted-filtered; pending is empty on open boards.
  const pending =
    curated && board
      ? ideas.filter((i) => !hidden.has(i.id) && !banned.has(i.pubkey) && !isApproved(i))
      : [];

  return { board, ideas: ideaViews, replies, tallies, deleted, hidden, banned, locks, pins, pending };
}

/**
 * Per-idea stats for the indexer / list APIs: the IdeaStat projection of deriveBoardView. Kept as a
 * separate, stable shape (drops byPubkey, the replies array, and the per-target maps) so the indexer's
 * storage and sort code is unaffected by the richer view the client needs.
 */
export function deriveBoardStats(events: NostrEvent[]): BoardAggregate {
  const view = deriveBoardView(events);
  const ideas: IdeaStat[] = view.ideas.map((v) => ({
    id: v.idea.id,
    title: v.idea.title,
    body: v.idea.body,
    author: v.idea.pubkey,
    createdAt: v.idea.createdAt,
    categories: v.idea.categories,
    score: v.tally.score,
    up: v.tally.up,
    down: v.tally.down,
    replyCount: v.replyCount,
    status: v.status,
    pinned: v.pinned,
    approved: v.approved,
  }));
  return { board: view.board, ideas, banned: view.banned, hidden: view.hidden };
}

/** Sort ideas pinned-first, then by the chosen key. `nowSeconds` is injectable for deterministic tests. */
export function sortIdeaStats(
  rows: IdeaStat[],
  sort: IdeaSort,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): IdeaStat[] {
  const pinnedFirst = (a: IdeaStat, b: IdeaStat) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
  const out = [...rows];
  if (sort === "new") {
    out.sort((a, b) => pinnedFirst(a, b) || b.createdAt - a.createdAt);
  } else if (sort === "trending") {
    // Clamp age to >= 0: a forged future created_at would make (now - createdAt) negative and
    // Math.pow(negative, 1.5) = NaN, and a NaN comparator scrambles the whole sort (not just that item).
    const rank = (r: IdeaStat) => (r.score + 1) / Math.pow(Math.max(0, nowSeconds - r.createdAt) / 3600 + 2, 1.5);
    out.sort((a, b) => pinnedFirst(a, b) || rank(b) - rank(a));
  } else {
    out.sort((a, b) => pinnedFirst(a, b) || b.score - a.score || b.createdAt - a.createdAt);
  }
  return out;
}

/** Visible ideas only (not hidden, author not banned, approved on curated boards), filtered + sorted. */
export function visibleIdeas(
  aggregate: BoardAggregate,
  opts: { sort?: IdeaSort; status?: string; tag?: string; nowSeconds?: number } = {},
): IdeaStat[] {
  let rows = aggregate.ideas.filter(
    (r) => r.approved && !aggregate.hidden.has(r.id) && !aggregate.banned.has(r.author),
  );
  if (opts.status) rows = rows.filter((r) => r.status === opts.status);
  if (opts.tag) rows = rows.filter((r) => r.categories.includes(opts.tag!));
  return sortIdeaStats(rows, opts.sort ?? "top", opts.nowSeconds);
}
