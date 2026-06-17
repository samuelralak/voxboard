import "server-only";

import { cache } from "react";
import { SimplePool } from "nostr-tools/pool";
import { queryProfile } from "nostr-tools/nip05";
import { verifyEvent } from "nostr-tools/pure";
import {
  KIND,
  isBoardAttested,
  isSafeRelayUrl,
  parseBoard,
  parseCommunityCoordinate,
  parseIdea,
  parseReply,
  partitionBoardEvents,
  validateNostrEvent,
  type Board,
  type Idea,
  type NostrEvent,
} from "@voxboard/protocol";
import { notNull } from "./event";
import { attestationNs, issuerPubkey } from "@/lib/attestation";
import { fetchAllowlist } from "./attestation-gate";
import { DEFAULT_RELAYS } from "./relays";

/** Resolve a relay set, SSRF-gating attacker-controllable naddr/nevent hints; never returns an empty set. */
function relaysOrDefault(relays: readonly string[]): string[] {
  const safe = (relays.length > 0 ? relays : DEFAULT_RELAYS).filter(isSafeRelayUrl);
  return safe.length > 0 ? safe : [...DEFAULT_RELAYS];
}

/** Envelope-valid AND Schnorr-verified, so a relay can't smuggle a forged event past the SSR read boundary. */
function verified(event: unknown): NostrEvent | null {
  const valid = validateNostrEvent(event);
  return valid && verifyEvent(valid as NostrEvent & { sig: string }) ? valid : null;
}

/** Parse verified board events, keeping the latest per coordinate. */
function latestBoards(events: readonly unknown[]): Board[] {
  const byCoordinate = new Map<string, Board>();
  for (const event of events) {
    const valid = verified(event);
    if (!valid) continue;
    const board = parseBoard(valid);
    if (!board) continue;
    const prev = byCoordinate.get(board.coordinate);
    if (!prev || board.createdAt > prev.createdAt) byCoordinate.set(board.coordinate, board);
  }
  return [...byCoordinate.values()];
}

export interface BoardSnapshot {
  board: Board | null;
  ideas: Idea[];
  /** raw kind-1111 replies for the board, so reply counts render on first paint instead of depending
   *  entirely on the live `#A` sub (which can be slow/empty and left the feed showing no reply counts) */
  replies: NostrEvent[];
  /** raw kind-1985 labels + kind-4550 approvals, so the client can resolve moderation on first paint */
  moderation: NostrEvent[];
  /** raw kind-7 reactions for the snapshot's ideas, so scores don't flash to 0 on a back-nav remount */
  votes: NostrEvent[];
  /** raw kind-5 deletions of the snapshot's content, so a retraction stays applied across remounts */
  deletions: NostrEvent[];
  /** true when the board's CURRENT version is platform-attested (drives the "Attested" badge) */
  attested: boolean;
}

/**
 * Request-scoped, read-only relay snapshot for first paint + generateMetadata + OG images. One-shot
 * `querySync` (opens, queries, closes), so it is safe on serverless. Idea/reply/vote sigs are re-verified
 * live on the client; the SSR snapshot Schnorr-verifies the BOARD event and the issuer attestation labels
 * (both feed trust decisions: the board content under an attested coordinate, and the badge). Node 22+
 * provides a global WebSocket, which the Next server runtime uses.
 *
 * The exported entry is wrapped in React's cache() keyed by a stable (coordinate, sorted-relays) string, so
 * generateMetadata and the page body share ONE snapshot per request instead of re-running the queries.
 */
/** Exported for tests: the un-cached snapshot impl, with an injectable pool (a fake relay in tests). */
export async function fetchBoardSnapshotImpl(
  coordinate: string,
  relays: readonly string[],
  injectedPool?: SimplePool,
): Promise<BoardSnapshot> {
  const ref = parseCommunityCoordinate(coordinate);
  if (!ref) return { board: null, ideas: [], replies: [], moderation: [], votes: [], deletions: [], attested: false };

  const relaySet = relaysOrDefault(relays);
  const issuer = issuerPubkey();
  const pool = injectedPool ?? new SimplePool();
  try {
    const [boardEvents, ideaEvents, labelEvents, approvalEvents, attestEvents] = await Promise.all([
      pool.querySync(
        relaySet,
        { kinds: [KIND.Community], authors: [ref.pubkey], "#d": [ref.slug] },
        { maxWait: 4000 },
      ),
      pool.querySync(relaySet, { kinds: [KIND.Comment], "#A": [coordinate] }, { maxWait: 4000 }),
      pool.querySync(relaySet, { kinds: [KIND.Label], "#a": [coordinate] }, { maxWait: 4000 }),
      pool.querySync(relaySet, { kinds: [KIND.PostApproval], "#a": [coordinate] }, { maxWait: 4000 }),
      // Badge: a DEDICATED issuer-pinned label query, so unbounded spam labels on a popular coordinate can't
      // crowd the issuer's attestation label out of the (author-unfiltered) moderation query's window.
      issuer
        ? pool.querySync(relaySet, { kinds: [KIND.Label], "#a": [coordinate], authors: [issuer] }, { maxWait: 4000 })
        : Promise.resolve([] as NostrEvent[]),
    ]);

    // Schnorr-verify board events BEFORE picking the newest, so a forged high-created_at board event can't
    // win selection (and then fail verify, hiding the real board) or surface forged content under the coord.
    const newestBoard = boardEvents.map(verified).filter(notNull).sort((a, b) => b.created_at - a.created_at)[0];
    const board = newestBoard ? parseBoard(newestBoard) : null;
    const validIdeaEvents = ideaEvents.map(validateNostrEvent).filter(notNull);
    const { ideas, replies } = partitionBoardEvents(validIdeaEvents);
    const moderation = [...labelEvents, ...approvalEvents].map(validateNostrEvent).filter(notNull);

    // Second pass: votes for the ideas + deletions of any content we just fetched. These reference the
    // events by id (not the board coordinate), so they can only be queried once the ids are known. They
    // seed the client's secondary subscriptions, which NDK can momentarily return empty on a back-nav
    // remount, so scores never flash to 0 and a retraction never un-applies. (See use-board-data.ts.)
    const ideaIds = ideas.map((i) => i.id);
    const contentIds = [
      ...ideaIds,
      ...replies.map((r) => r.id),
      ...moderation.map((e) => e.id),
    ];
    const [voteEvents, deletionEvents] = await Promise.all([
      ideaIds.length > 0
        ? pool.querySync(relaySet, { kinds: [KIND.Reaction], "#e": ideaIds }, { maxWait: 3000 })
        : Promise.resolve([] as NostrEvent[]),
      contentIds.length > 0
        ? pool.querySync(relaySet, { kinds: [KIND.Delete], "#e": contentIds }, { maxWait: 3000 })
        : Promise.resolve([] as NostrEvent[]),
    ]);
    const votes = voteEvents.map(validateNostrEvent).filter(notNull);
    // Vote retractions (kind-5 targeting a reaction id) are not covered by contentIds; seed them so a
    // retracted vote doesn't transiently count at first paint before the live `#e` deletions sub round-
    // trips. Bounded (maxWait 2000, only when votes exist): adds up to ~2s to the awaited SSR response, but
    // the visible idea content is already resolved by the prior passes.
    const voteIds = votes.map((v) => v.id);
    const voteDeletions =
      voteIds.length > 0
        ? await pool.querySync(relaySet, { kinds: [KIND.Delete], "#e": voteIds }, { maxWait: 2000 })
        : [];
    const deletions = [...deletionEvents, ...voteDeletions].map(validateNostrEvent).filter(notNull);

    // The platform "Attested" badge, from the DEDICATED issuer-pinned label query. The labels MUST be
    // Schnorr-verified here (collapseAttestationLabels only pins the issuer pubkey, not the signature), or a
    // relay could serve a forged issuer-pubkey label and mint a fake badge. isBoardAttested then pins the
    // issuer + env namespace and requires the label event-id to equal THIS board version (auto-revokes on
    // edit). The flag is for board.raw.id; the client re-checks it against the displayed version (board-view).
    const attestLabels = attestEvents.map(verified).filter(notNull);
    const attested =
      !!board && !!issuer && isBoardAttested(attestLabels, issuer, attestationNs(), board.coordinate, board.raw.id);

    return { board, ideas, replies: replies.map((r) => r.raw), moderation, votes, deletions, attested };
  } finally {
    if (!injectedPool) pool.close(relaySet); // only close a pool we own
  }
}

/**
 * Deduped board snapshot: cache() collapses the generateMetadata + page-body calls within one request to a
 * single set of relay queries. The key is a stable string (coordinate + SSRF-gated, sorted relays), since
 * cache() compares args by identity and the two call sites decode the naddr into different array instances.
 */
const fetchBoardSnapshotByKey = cache((coordinate: string, relaysKey: string): Promise<BoardSnapshot> =>
  fetchBoardSnapshotImpl(coordinate, relaysKey ? relaysKey.split(",") : []),
);

export function fetchBoardSnapshot(coordinate: string, relays: readonly string[] = []): Promise<BoardSnapshot> {
  return fetchBoardSnapshotByKey(coordinate, relaysOrDefault(relays).slice().sort().join(","));
}

/** Walk at most this many NIP-22 parent hops resolving a reply up to its root idea (a real feedback
 * thread is shallow; the cap bounds an adversarial/cyclic parent chain). */
const MAX_IDEA_RESOLVE_HOPS = 16;

/**
 * Resolve an event id to its root idea (kind 1111): if the id is a top-level idea, return it; if it is a
 * REPLY, climb the lowercase `e` parent chain to the owning idea. Bounded and cycle-guarded. Shared by
 * fetchIdeaSnapshot (metadata/OG) and fetchIdeaThreadSnapshot (full first paint).
 */
async function resolveRootIdea(pool: SimplePool, relaySet: string[], id: string): Promise<Idea | null> {
  const seen = new Set<string>();
  let currentId = id;
  for (let hop = 0; hop < MAX_IDEA_RESOLVE_HOPS; hop++) {
    if (seen.has(currentId)) return null; // cycle guard
    seen.add(currentId);
    const events = await pool.querySync(relaySet, { kinds: [KIND.Comment], ids: [currentId] }, { maxWait: 4000 });
    const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!newest) return null;
    const valid = validateNostrEvent(newest);
    if (!valid) return null;
    const idea = parseIdea(valid);
    if (idea) return idea;
    // Not a top-level idea: if it is a reply, climb to its immediate parent and try again.
    const reply = parseReply(valid);
    if (!reply) return null;
    currentId = reply.parentId;
  }
  return null; // chain deeper than the cap (treated as unresolvable)
}

/**
 * Resolve an event id to its root idea for idea-detail metadata/OG. When the id is a reply (e.g. a
 * notification target — someone replied to your reply) it lands on the owning idea instead of 404ing.
 */
export async function fetchIdeaSnapshot(
  id: string,
  relays: readonly string[] = [],
): Promise<Idea | null> {
  const relaySet = relaysOrDefault(relays);
  const pool = new SimplePool();
  try {
    return await resolveRootIdea(pool, relaySet, id);
  } finally {
    pool.close(relaySet);
  }
}

export interface IdeaThreadSnapshot {
  idea: Idea | null;
  /** the parsed board (kind 34550), so the reply box renders on first paint instead of depending on a
   *  client-only `useBoard` sub that can come back empty on a remount (which hides the reply control) */
  board: Board | null;
  /** raw kind-1111 events for the board (ideas + replies), to seed the thread sub so replies render on
   *  first paint instead of waiting on (or missing) the live `#A` subscription */
  thread: NostrEvent[];
  /** raw kind-1985 labels + kind-4550 approvals for the coordinate (hide/ban/lock/status resolution) */
  moderation: NostrEvent[];
  /** raw kind-7 reactions for the idea + its replies */
  votes: NostrEvent[];
  /** raw kind-5 deletions of the thread content + labels, so a retraction stays applied across remounts */
  deletions: NostrEvent[];
}

/**
 * Full first-paint snapshot for /d/[nevent]: the root idea PLUS its board's replies, moderation, votes,
 * and deletions. Symmetric to fetchBoardSnapshot's two-pass pattern, and the fix for "replies never
 * appear": the thread no longer starts from an empty client store gated on a live subscription, and the
 * nevent's relay hints (passed as `relays`) are queried, so replies that live off the default relays are
 * still seeded. Sigs are re-verified live on the client; this snapshot only validates the envelope.
 */
export async function fetchIdeaThreadSnapshot(
  id: string,
  relays: readonly string[] = [],
): Promise<IdeaThreadSnapshot> {
  const relaySet = relaysOrDefault(relays);
  const pool = new SimplePool();
  try {
    const idea = await resolveRootIdea(pool, relaySet, id);
    if (!idea) return { idea: null, board: null, thread: [], moderation: [], votes: [], deletions: [] };

    const coordinate = idea.coordinate;
    const [boardEvents, threadEvents, labelEvents, approvalEvents] = await Promise.all([
      pool.querySync(
        relaySet,
        { kinds: [KIND.Community], authors: [idea.board.pubkey], "#d": [idea.board.slug] },
        { maxWait: 4000 },
      ),
      pool.querySync(relaySet, { kinds: [KIND.Comment], "#A": [coordinate] }, { maxWait: 4000 }),
      pool.querySync(relaySet, { kinds: [KIND.Label], "#a": [coordinate] }, { maxWait: 4000 }),
      pool.querySync(relaySet, { kinds: [KIND.PostApproval], "#a": [coordinate] }, { maxWait: 4000 }),
    ]);
    // Schnorr-verify boards BEFORE selection (mirrors fetchBoardSnapshot): a forged far-future board event
    // can't win selection (and a non-null assertion on a null-validated event can't crash the idea route).
    const newestBoard = boardEvents.map(verified).filter(notNull).sort((a, b) => b.created_at - a.created_at)[0];
    const board = newestBoard ? parseBoard(newestBoard) : null;
    const thread = threadEvents.map(validateNostrEvent).filter(notNull);
    const moderation = [...labelEvents, ...approvalEvents].map(validateNostrEvent).filter(notNull);

    // Second pass: votes for the idea + its replies, and deletions of the thread content + labels. These
    // reference events by id, so they can only be queried once the reply ids are known.
    const { replies } = partitionBoardEvents(thread);
    const replyIds = replies.map((r) => r.id);
    const voteTargetIds = [idea.id, ...replyIds];
    const contentIds = [idea.id, ...replyIds, ...moderation.map((e) => e.id)];
    const [voteEvents, deletionEvents] = await Promise.all([
      pool.querySync(relaySet, { kinds: [KIND.Reaction], "#e": voteTargetIds }, { maxWait: 3000 }),
      pool.querySync(relaySet, { kinds: [KIND.Delete], "#e": contentIds }, { maxWait: 3000 }),
    ]);
    const votes = voteEvents.map(validateNostrEvent).filter(notNull);
    // Vote retractions (kind-5 targeting a reaction id) are not covered by contentIds; seed them so a
    // retracted vote doesn't transiently count at first paint before the live `#e` deletions sub round-
    // trips. Bounded (maxWait 2000, only when votes exist): adds up to ~2s to the awaited SSR response, but
    // the visible idea content is already resolved by the prior passes.
    const voteIds = votes.map((v) => v.id);
    const voteDeletions =
      voteIds.length > 0
        ? await pool.querySync(relaySet, { kinds: [KIND.Delete], "#e": voteIds }, { maxWait: 2000 })
        : [];
    const deletions = [...deletionEvents, ...voteDeletions].map(validateNostrEvent).filter(notNull);

    return { idea, board, thread, moderation, votes, deletions };
  } finally {
    pool.close(relaySet);
  }
}

/** Latest board per slug authored by a pubkey (an org's boards). */
export async function fetchOrgBoards(
  pubkey: string,
  relays: readonly string[] = [],
): Promise<Board[]> {
  const relaySet = relaysOrDefault(relays);
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      relaySet,
      { kinds: [KIND.Community], authors: [pubkey] },
      { maxWait: 4000 },
    );
    return latestBoards(events).sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    pool.close(relaySet);
  }
}

/** Cap the `authors` filter per REQ; a large allowlist is chunked so a relay's author limit can't blank discover. */
const DISCOVER_AUTHOR_BATCH = 100;

/**
 * Boards for the discover surface, STRICT-ALLOWLIST filtered: production shows only platform-attested
 * boards (see docs/ATTESTATION.md). The allowlist is the issuer-signed set, re-verified in fetchAllowlist.
 * When attestation isn't configured (or a blind read with no cache), it falls back to recent boards
 * unfiltered. When the allowlist is non-empty, fetch boards by the attested OWNERS (chunked) then keep
 * exactly the attested coordinates, so every attested board surfaces (not just those in a recent window).
 * One SimplePool is shared by the allowlist fetch and the board fetch (one connection, closed once).
 */
export async function fetchDiscoverBoards(
  limit = 30,
  relays: readonly string[] = [],
  injectedPool?: SimplePool,
): Promise<Board[]> {
  const relaySet = relaysOrDefault(relays);
  const pool = injectedPool ?? new SimplePool();
  try {
    const allowlist = await fetchAllowlist(relays, pool);

    if (allowlist.coords === null) {
      // unconfigured / fail-open blind: recent boards, unfiltered (same pool)
      const events = await pool.querySync(relaySet, { kinds: [KIND.Community], limit }, { maxWait: 4000 });
      return latestBoards(events).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    }
    if (allowlist.coords.size === 0) return []; // attestation on, nothing attested yet

    const owners = [
      ...new Set(
        [...allowlist.coords].map((c) => parseCommunityCoordinate(c)?.pubkey).filter((p): p is string => !!p),
      ),
    ];
    const batches: Promise<unknown[]>[] = [];
    for (let i = 0; i < owners.length; i += DISCOVER_AUTHOR_BATCH) {
      const chunk = owners.slice(i, i + DISCOVER_AUTHOR_BATCH);
      batches.push(pool.querySync(relaySet, { kinds: [KIND.Community], authors: chunk }, { maxWait: 4000 }));
    }
    const events = (await Promise.all(batches)).flat();
    return latestBoards(events)
      .filter((b) => allowlist.coords!.has(b.coordinate))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  } finally {
    pool.close(relaySet);
  }
}

/** Resolve a NIP-05 identifier (name@domain or bare domain) to a pubkey + relay hints. */
export async function resolveNip05(
  handle: string,
): Promise<{ pubkey: string; relays: string[] } | null> {
  try {
    const profile = await queryProfile(handle);
    if (!profile) return null;
    return { pubkey: profile.pubkey, relays: profile.relays ?? [] };
  } catch {
    return null;
  }
}
