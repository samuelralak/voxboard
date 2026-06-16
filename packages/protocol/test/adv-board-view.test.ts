import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event";
import { buildBoard } from "../src/board";
import { buildIdea } from "../src/idea";
import { buildReply } from "../src/reply";
import { buildVote } from "../src/vote";
import { buildStatus } from "../src/status";
import { buildHide, buildPin, buildBan, buildLock } from "../src/moderation";
import { buildApproval } from "../src/approval";
import { buildDelete } from "../src/delete";
import { KIND } from "../src/kinds";
import { deriveBoardStats, deriveBoardView, type BoardView, type IdeaStat } from "../src/aggregate";

/**
 * The gate for the deriveBoardView extraction: deriveBoardStats MUST stay exactly the IdeaStat projection
 * of deriveBoardView, across every adversarial dimension (deletions, bans, locks, curated approvals,
 * replies). If these drift, the indexer and the client read path diverge — the one thing the project
 * guarantees they never do. Also pins down the SUPERSET fields (byPubkey, replies, tallies, pending).
 */

const SIG = "0".repeat(128);
const OWNER = "a1".repeat(32);
const MOD = "b2".repeat(32);
const A1 = "c3".repeat(32);
const A2 = "d4".repeat(32);
const A3 = "e5".repeat(32);
const V1 = "f1".repeat(32);
const V2 = "f2".repeat(32);
const BAD = "ba".repeat(32); // a banned author
const SLUG = "voxboard";
const BOARD = { pubkey: OWNER, slug: SLUG };
const IDEA1 = "1d".repeat(32);
const IDEA2 = "2d".repeat(32);
const IDEA3 = "3d".repeat(32);

let counter = 1000;
function ev(t: EventTemplate, pubkey: string, id?: string): NostrEvent {
  return { ...t, pubkey, id: id ?? (counter++).toString(16).padStart(64, "0"), sig: SIG };
}

/** The exact projection deriveBoardStats performs — the equivalence target. */
function project(view: BoardView): IdeaStat[] {
  return view.ideas.map((v) => ({
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
}

// ---------------------------------------------------------------------------
// fixture sets, each exercising a different read-time dimension
// ---------------------------------------------------------------------------
function rich(): NostrEvent[] {
  return [
    ev(buildBoard({ slug: SLUG, name: "Voxboard", moderators: [{ pubkey: MOD }] }), OWNER),
    ev(buildIdea({ board: BOARD, title: "Idea 1", categories: ["feature"], createdAt: 100 }), A1, IDEA1),
    ev(buildIdea({ board: BOARD, title: "Idea 2", categories: ["bug"], createdAt: 200 }), A2, IDEA2),
    ev(buildIdea({ board: BOARD, title: "Spam", createdAt: 300 }), A3, IDEA3),
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 110 }), V1),
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 111 }), V2),
    ev(buildVote({ target: { id: IDEA2, pubkey: A2 }, direction: "up", createdAt: 210 }), V1),
    ev(buildVote({ target: { id: IDEA2, pubkey: A2 }, direction: "down", createdAt: 211 }), V2),
    ev(buildStatus({ target: { id: IDEA1 }, board: BOARD, state: "planned", createdAt: 120 }), OWNER),
    ev(buildHide({ target: { id: IDEA3 }, board: BOARD, createdAt: 320 }), MOD),
    ev(buildPin({ target: { id: IDEA2 }, board: BOARD, createdAt: 220 }), OWNER),
    ev(buildHide({ target: { id: IDEA1 }, board: BOARD, createdAt: 130 }), A2), // unauthorized: ignored
  ];
}

function withDeletions(): NostrEvent[] {
  const voteA = ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 110 }), V1);
  return [
    ev(buildBoard({ slug: SLUG, name: "Voxboard" }), OWNER),
    ev(buildIdea({ board: BOARD, title: "Idea 1", createdAt: 100 }), A1, IDEA1),
    ev(buildIdea({ board: BOARD, title: "Idea 2", createdAt: 200 }), A2, IDEA2),
    voteA,
    // A1 retracts their own upvote -> idea1 score back to 0 on the first derive pass.
    ev(buildDelete({ ids: [voteA.id], kinds: [KIND.Reaction] }), V1),
    // A2 retracts idea2 entirely -> it disappears.
    ev(buildDelete({ ids: [IDEA2], kinds: [KIND.Comment] }), A2),
  ];
}

function withBanAndLock(): NostrEvent[] {
  return [
    ev(buildBoard({ slug: SLUG, name: "Voxboard", moderators: [{ pubkey: MOD }] }), OWNER),
    ev(buildIdea({ board: BOARD, title: "Idea 1", createdAt: 100 }), A1, IDEA1),
    // a banned author's upvote must not count
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 110 }), V1),
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 111 }), BAD),
    ev(buildBan({ subject: BAD, board: BOARD, createdAt: 50 }), OWNER),
    // a locked thread drops replies created after the cutoff
    ev(buildReply({ board: BOARD, parent: { id: IDEA1, pubkey: A1, kind: KIND.Comment }, body: "early", createdAt: 120 }), A2),
    ev(buildReply({ board: BOARD, parent: { id: IDEA1, pubkey: A1, kind: KIND.Comment }, body: "late", createdAt: 400 }), A3),
    ev(buildLock({ target: { id: IDEA1 }, board: BOARD, createdAt: 200 }), MOD),
  ];
}

function curatedBoard(): { events: NostrEvent[]; ideaApproved: NostrEvent; ideaPending: NostrEvent } {
  const ideaApproved = ev(buildIdea({ board: BOARD, title: "Approved", createdAt: 100 }), A1, IDEA1);
  const ideaPending = ev(buildIdea({ board: BOARD, title: "Pending", createdAt: 200 }), A2, IDEA2);
  const ideaByMod = ev(buildIdea({ board: BOARD, title: "Mod post", createdAt: 300 }), MOD, IDEA3);
  return {
    ideaApproved,
    ideaPending,
    events: [
      ev(buildBoard({ slug: SLUG, name: "Voxboard", mode: "curated", moderators: [{ pubkey: MOD }] }), OWNER),
      ideaApproved,
      ideaPending,
      ideaByMod, // a mod's own post is implicitly approved
      ev(buildApproval({ board: BOARD, post: ideaApproved, createdAt: 150 }), OWNER),
    ],
  };
}

function withReplies(): NostrEvent[] {
  const r1 = ev(buildReply({ board: BOARD, parent: { id: IDEA1, pubkey: A1, kind: KIND.Comment }, body: "r1", createdAt: 110 }), A2);
  return [
    ev(buildBoard({ slug: SLUG, name: "Voxboard" }), OWNER),
    ev(buildIdea({ board: BOARD, title: "Idea 1", createdAt: 100 }), A1, IDEA1),
    r1,
    ev(buildReply({ board: BOARD, parent: { id: r1.id, pubkey: A2, kind: KIND.Comment }, body: "r1.1", createdAt: 120 }), A3),
    ev(buildReply({ board: BOARD, parent: { id: IDEA1, pubkey: A1, kind: KIND.Comment }, body: "r2", createdAt: 130 }), A3),
  ];
}

const SETS: Array<[string, NostrEvent[]]> = [
  ["rich", rich()],
  ["deletions", withDeletions()],
  ["ban+lock", withBanAndLock()],
  ["curated", curatedBoard().events],
  ["replies", withReplies()],
];

describe("deriveBoardView ⇄ deriveBoardStats equivalence", () => {
  for (const [name, events] of SETS) {
    it(`deriveBoardStats === project(deriveBoardView) — ${name}`, () => {
      const stats = deriveBoardStats(events);
      const view = deriveBoardView(events);
      // The IdeaStat projection must be byte-for-byte equal (order included).
      expect(project(view)).toEqual(stats.ideas);
      // And the pass-through sets.
      expect([...view.banned].sort()).toEqual([...stats.banned].sort());
      expect([...view.hidden].sort()).toEqual([...stats.hidden].sort());
      expect(view.board?.coordinate).toBe(stats.board?.coordinate);
    });
  }
});

describe("deriveBoardView regressions (the bugs the refactor must keep fixed)", () => {
  it("a self-retracted upvote shows score 0 on the first derive pass", () => {
    const view = deriveBoardView(withDeletions());
    const idea1 = view.ideas.find((v) => v.idea.id === IDEA1)!;
    expect(idea1.tally.score).toBe(0);
    expect(idea1.tally.byPubkey.size).toBe(0); // the only voter retracted
  });

  it("a banned author's vote is excluded identically for the tally and the byPubkey map", () => {
    const view = deriveBoardView(withBanAndLock());
    const idea1 = view.ideas.find((v) => v.idea.id === IDEA1)!;
    expect(view.banned.has(BAD)).toBe(true);
    expect(idea1.tally.score).toBe(1); // V1 counts, BAD does not
    expect(idea1.tally.byPubkey.has(BAD)).toBe(false);
  });

  it("a locked thread drops replies past the cutoff from the count AND the replies array", () => {
    const view = deriveBoardView(withBanAndLock());
    const idea1 = view.ideas.find((v) => v.idea.id === IDEA1)!;
    expect(idea1.replyCount).toBe(1); // "early" counts, "late" is past the lock cutoff
    // the replies array itself is unfiltered by lock (lock only affects counts), so both survive there
    expect(view.replies.filter((r) => r.parentId === IDEA1).length).toBe(2);
  });

  it("curated board: unapproved non-mod ideas are pending; approved + mod posts are not", () => {
    const { events } = curatedBoard();
    const view = deriveBoardView(events);
    const pendingIds = view.pending.map((i) => i.id).sort();
    expect(pendingIds).toEqual([IDEA2]); // only the unapproved non-mod idea
    expect(view.ideas.find((v) => v.idea.id === IDEA1)!.approved).toBe(true); // approved
    expect(view.ideas.find((v) => v.idea.id === IDEA3)!.approved).toBe(true); // mod's own post
  });

  it("exposes per-target byPubkey tallies that IdeaStat drops", () => {
    const view = deriveBoardView(rich());
    const idea1 = view.ideas.find((v) => v.idea.id === IDEA1)!;
    expect(idea1.tally.byPubkey.get(V1)).toBe("up"); // voter V1's deduped latest direction
    expect(idea1.tally.byPubkey.size).toBe(2); // V1 and V2 both upvoted idea1
    expect(view.tallies.get(IDEA2)?.score).toBe(0); // 1 up + 1 down
  });

  it("nested replies are counted and surfaced in the replies array", () => {
    const view = deriveBoardView(withReplies());
    expect(view.ideas.find((v) => v.idea.id === IDEA1)!.replyCount).toBe(3); // r1, r1.1, r2
    expect(view.replies.length).toBe(3);
  });
});
