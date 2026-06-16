/**
 * Adversarial coverage for the shared "indexer" aggregate (deriveBoardStats / sortIdeaStats /
 * visibleIdeas) and the moderation/status/approval/lock parse helpers that the Durable Object and the
 * web client both rely on. The file header of aggregate.ts claims the aggregator and any client "can
 * never disagree"; these cases probe exactly the spots where the shared function drops protocol
 * features (deletions of labels, curated approvals, lock cutoffs, the unpin off-state, hidden-reply and
 * banned-author count suppression, board-version tiebreak, cross-board label scoping, NaN trending).
 *
 * Where the code is correct we assert the correct result. Where the code is WRONG vs a faithful Nostr
 * implementation we STILL assert the correct behavior, so the test fails and pins the defect. Each such
 * assertion is tagged BUG: in a comment and listed in the report's suspectedBugs.
 *
 * Deduplicated against adversarial.test.ts (idea/vote self-delete, thread cycles, vote tally basics),
 * aggregate.test.ts (happy-path derive), events.test.ts (label/lock parse + collapse), thread.test.ts,
 * coords.test.ts. Only NEW protocol-unit cases live here.
 */

import { describe, it, expect } from "vitest";
import type { NostrEvent } from "../src/event";
import { KIND, LABEL_NS } from "../src/kinds";
import { buildIdea } from "../src/idea";
import { buildReply } from "../src/reply";
import { buildVote, parseVote } from "../src/vote";
import { buildBoard } from "../src/board";
import { buildStatus, parseStatus } from "../src/status";
import {
  buildPin,
  buildHide,
  buildBan,
} from "../src/moderation";
import { deriveBoardStats, sortIdeaStats, visibleIdeas, type IdeaStat } from "../src/aggregate";

// ---------------------------------------------------------------------------
// Identities + helpers (mirrors the existing suite's conventions)
// ---------------------------------------------------------------------------

const SIG = "0".repeat(128);
const OWNER = "a1".repeat(32);
const MOD = "b2".repeat(32);
const A1 = "c3".repeat(32);
const A2 = "d4".repeat(32);
const MALLORY = "e5".repeat(32);
const V1 = "f1".repeat(32);
const V2 = "f2".repeat(32);
const SLUG = "voxboard";
const COORD = `34550:${OWNER}:${SLUG}`;
const BOARD = { pubkey: OWNER, slug: SLUG };

const IDEA1 = "1d".repeat(32);
const IDEA2 = "2d".repeat(32);

let n = 1;
function raw(o: Partial<NostrEvent> & { kind: number }): NostrEvent {
  return {
    id: o.id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    pubkey: o.pubkey ?? A1,
    sig: SIG,
    kind: o.kind,
    content: o.content ?? "",
    created_at: o.created_at ?? 1000,
    tags: o.tags ?? [],
  };
}

const ev = (
  template: { kind: number; created_at: number; tags: string[][]; content: string },
  pubkey: string,
  id?: string,
): NostrEvent => ({
  ...template,
  pubkey,
  id: id ?? `id${(n++).toString(16).padStart(61, "0")}`,
  sig: SIG,
});

/** A board (community def) event. */
function boardEvent(
  opts: { name?: string; mode?: "open" | "curated"; mods?: string[]; createdAt?: number; id?: string } = {},
): NostrEvent {
  return ev(
    buildBoard({
      slug: SLUG,
      name: opts.name ?? "Vox",
      mode: opts.mode ?? "open",
      moderators: (opts.mods ?? []).map((pubkey) => ({ pubkey })),
      createdAt: opts.createdAt ?? 10,
    }),
    OWNER,
    opts.id,
  );
}

function ideaEvent(
  id: string,
  pubkey: string,
  opts: { title?: string; createdAt?: number; categories?: string[] } = {},
): NostrEvent {
  return ev(
    buildIdea({
      board: BOARD,
      title: opts.title ?? `Idea ${id.slice(0, 4)}`,
      categories: opts.categories ?? [],
      createdAt: opts.createdAt ?? 100,
    }),
    pubkey,
    id,
  );
}

function replyEvent(
  id: string,
  parentId: string,
  pubkey: string,
  opts: { createdAt?: number } = {},
): NostrEvent {
  return ev(
    buildReply({
      board: BOARD,
      parent: { id: parentId, pubkey: A1, kind: 1111 },
      body: id,
      createdAt: opts.createdAt ?? 100,
    }),
    pubkey,
    id,
  );
}

function voteEvent(
  targetId: string,
  pubkey: string,
  direction: "up" | "down",
  opts: { createdAt?: number; id?: string } = {},
): NostrEvent {
  return ev(
    buildVote({ target: { id: targetId, pubkey: A1 }, direction, createdAt: opts.createdAt ?? 100 }),
    pubkey,
    opts.id,
  );
}

function find(stats: { ideas: IdeaStat[] }, id: string): IdeaStat | undefined {
  return stats.ideas.find((i) => i.id === id);
}

// ---------------------------------------------------------------------------
// 1. NIP-09 deletion of LABELS is never honored by deriveBoardStats
//    (aggregate.ts only applies `deleted` to comments + reactions, never labels/board).
// ---------------------------------------------------------------------------

describe("indexer: deletion of moderation labels is not honored by the aggregate", () => {
  it("a deleted status label still reverts? -> currently NO (status stays). BUG", () => {
    const label = ev(
      buildStatus({ target: { id: IDEA1 }, board: BOARD, state: "planned", createdAt: 120 }),
      OWNER,
      "aa".repeat(32),
    );
    const del = raw({
      kind: KIND.Delete,
      pubkey: OWNER,
      created_at: 130,
      tags: [["e", "aa".repeat(32)], ["k", "1985"]],
    });
    const agg = deriveBoardStats([boardEvent(), ideaEvent(IDEA1, A1), label, del]);
    // Correct Nostr behavior: the owner retracted their own status label, so status reverts to null.
    // BUG: deriveBoardStats never filters labels by `deletedEventIds`, so the status survives.
    expect(find(agg, IDEA1)?.status).toBeNull();
  });

  it("a deleted pin label should unpin -> currently stays pinned. BUG", () => {
    const pin = ev(buildPin({ target: { id: IDEA1 }, board: BOARD, createdAt: 220 }), OWNER, "bb".repeat(32));
    const del = raw({
      kind: KIND.Delete,
      pubkey: OWNER,
      created_at: 230,
      tags: [["e", "bb".repeat(32)], ["k", "1985"]],
    });
    const agg = deriveBoardStats([boardEvent(), ideaEvent(IDEA1, A1), pin, del]);
    // BUG: deleting the pin label leaves IDEA1 pinned forever.
    expect(find(agg, IDEA1)?.pinned).toBe(false);
  });

  it("a deleted hide label should un-hide the idea -> currently stays hidden. BUG", () => {
    const hide = ev(buildHide({ target: { id: IDEA1 }, board: BOARD, createdAt: 220 }), OWNER, "cc".repeat(32));
    const del = raw({
      kind: KIND.Delete,
      pubkey: OWNER,
      created_at: 230,
      tags: [["e", "cc".repeat(32)], ["k", "1985"]],
    });
    const agg = deriveBoardStats([boardEvent(), ideaEvent(IDEA1, A1), hide, del]);
    // BUG: the hidden set still contains IDEA1 after its hide label was retracted.
    expect(agg.hidden.has(IDEA1)).toBe(false);
  });

  it("a deleted ban label should un-ban the subject -> currently stays banned. BUG", () => {
    const ban = ev(buildBan({ subject: MALLORY, board: BOARD, createdAt: 220 }), OWNER, "dd".repeat(32));
    const del = raw({
      kind: KIND.Delete,
      pubkey: OWNER,
      created_at: 230,
      tags: [["e", "dd".repeat(32)], ["k", "1985"]],
    });
    const agg = deriveBoardStats([boardEvent(), ideaEvent(IDEA1, MALLORY), ban, del]);
    // BUG: the banned set still contains MALLORY after the ban label was retracted.
    expect(agg.banned.has(MALLORY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Addressable (a-coordinate) board deletion is never applied to board events.
//    deriveBoardStats just takes the newest 34550 by created_at; it never checks deletions.
// ---------------------------------------------------------------------------

describe("indexer: board coordinate-delete is ignored by the aggregate", () => {
  it("when a delete-by-coordinate is the only board signal, the board should be gone. BUG", () => {
    const oldBoard = boardEvent({ name: "Old", createdAt: 100, id: "b0".repeat(32) });
    const del = raw({
      kind: KIND.Delete,
      pubkey: OWNER,
      created_at: 150,
      tags: [["a", COORD], ["k", "34550"]],
    });
    // No newer board exists. A relay honoring NIP-09 dropped the board; the indexer should too.
    const agg = deriveBoardStats([oldBoard, del, ideaEvent(IDEA1, A1)]);
    // BUG: deriveBoardStats keeps the deleted board because it never calls deletedEventIds on
    // board events, so board.name is still "Old" and the board is served as if it exists.
    expect(agg.board).toBeNull();
  });

  it("a newer board (created_at after the coordinate delete) survives", () => {
    const oldBoard = boardEvent({ name: "Old", createdAt: 100, id: "b0".repeat(32) });
    const del = raw({
      kind: KIND.Delete,
      pubkey: OWNER,
      created_at: 150,
      tags: [["a", COORD], ["k", "34550"]],
    });
    const newBoard = boardEvent({ name: "New", createdAt: 200, id: "b1".repeat(32) });
    // newest-wins happens to give the right answer here regardless of the delete.
    const agg = deriveBoardStats([oldBoard, del, newBoard, ideaEvent(IDEA1, A1)]);
    expect(agg.board?.name).toBe("New");
  });
});

// ---------------------------------------------------------------------------
// 3. Curated boards: approvals (kind 4550) are never applied -> unapproved ideas show.
// ---------------------------------------------------------------------------

describe("indexer: curated-mode approvals are not enforced", () => {
  it.todo("a curated board hides unapproved ideas (kind-4550 approval enforcement in the aggregate)"); // M3
});

// ---------------------------------------------------------------------------
// 4. Lock cutoffs are never applied to replyCount.
// ---------------------------------------------------------------------------

describe("indexer: locked-thread reply suppression is not applied", () => {
  it.todo("replies after the lock cutoff should not inflate replyCount (parseLock/lockCutoffs in the aggregate)"); // M3
});

// ---------------------------------------------------------------------------
// 5. Pin has no off-state: the documented "unpinned" label does not unpin.
// ---------------------------------------------------------------------------

describe("indexer: an explicit unpin label does not unpin", () => {
  it.todo("a later 'unpinned' label in the pin namespace should clear the pin (pin off-state in the aggregate)"); // M3
});

// ---------------------------------------------------------------------------
// 6. Hidden REPLIES still inflate replyCount (hidden set only filters ideas in visibleIdeas).
// ---------------------------------------------------------------------------

describe("indexer: hidden replies still count toward replyCount", () => {
  it.todo("hiding one reply should drop replyCount (hidden replies excluded from replyCount in the aggregate)"); // M3
});

// ---------------------------------------------------------------------------
// 7. A banned author's VOTES and REPLIES still count toward others' scores/threads.
//    (visibleIdeas filters banned AUTHORS out of the idea list, but tallies/threads do not.)
// ---------------------------------------------------------------------------

describe("indexer: banned author still influences scores and reply counts", () => {
  it.todo("a banned voter's upvote should not count toward the score (ban filtering applied to VOTES)"); // M3

  it.todo("a banned author's replies should not count toward replyCount (ban filtering applied to REPLIES)"); // M3
});

// ---------------------------------------------------------------------------
// 8. Board-version tie with equal created_at has NO id tiebreak: winner is order-dependent.
//    NIP-01 replaceable tiebreak (lowest id survives) is never applied to the 34550 selection.
// ---------------------------------------------------------------------------

describe("indexer: equal-created_at board versions resolve nondeterministically", () => {
  // Lower-id board is "curated" with no mods; higher-id board is "open" with MOD.
  const lowIdBoard = boardEvent({ name: "Low", mode: "curated", mods: [], createdAt: 5000, id: "00".repeat(32) });
  const highIdBoard = boardEvent({ name: "High", mode: "open", mods: [MOD], createdAt: 5000, id: "ff".repeat(32) });
  const idea = ideaEvent(IDEA1, A1);

  it("the surviving board version must be the lowest id (NIP-01) regardless of input order. BUG", () => {
    const a = deriveBoardStats([lowIdBoard, highIdBoard, idea]);
    const b = deriveBoardStats([highIdBoard, lowIdBoard, idea]);
    // NIP-01: on equal created_at, the lower id is the surviving replacement -> "Low"/curated.
    // BUG: boardEvents.sort((a,b)=>b.created_at-a.created_at) has no id tiebreak, so V8's stable
    // sort keeps whichever came first in the input. The two orderings disagree.
    expect(a.board?.name).toBe(b.board?.name);
    expect(a.board?.name).toBe("Low");
    expect(a.board?.mode).toBe("curated");
  });
});

// ---------------------------------------------------------------------------
// 9. Cross-board label leak: a label's a-tag coordinate is never compared to this board's coordinate.
// ---------------------------------------------------------------------------

describe("indexer: labels are not re-scoped to this board's coordinate", () => {
  it.todo("an owner status label carrying ANOTHER board's a-tag should not apply here (per-board label scoping)"); // M3
});

// ---------------------------------------------------------------------------
// 10. Forged future created_at poisons the trending sort with NaN.
// ---------------------------------------------------------------------------

describe("indexer: future created_at breaks the trending rank", () => {
  const base: Omit<IdeaStat, "id" | "score" | "createdAt"> = {
    title: "",
    body: "",
    author: A1,
    categories: [],
    approved: true,
    up: 0,
    down: 0,
    replyCount: 0,
    status: null,
    pinned: false,
  };
  const now = 1000;

  it("a far-future idea must not corrupt the ordering of the other ideas. BUG", () => {
    const rows: IdeaStat[] = [
      { ...base, id: "a", score: 1, createdAt: 100 },
      { ...base, id: "future", score: 0, createdAt: now + 1_000_000_000 },
      { ...base, id: "b", score: 5, createdAt: 200 },
      { ...base, id: "c", score: 3, createdAt: 300 },
    ];
    const sorted = sortIdeaStats(rows, "trending", now).map((r) => r.id);
    // rank(future) = Math.pow(negative, 1.5) = NaN. A NaN comparator value corrupts Array.sort, so
    // the honest ideas are no longer in descending-rank order. Among the non-future ideas, b (rank
    // 1.81) must come before c (1.23) before a (0.59).
    const withoutFuture = sorted.filter((id) => id !== "future");
    // BUG: this is violated because NaN scrambles unrelated pairs.
    expect(withoutFuture).toEqual(["b", "c", "a"]);
  });

  it("'new' sort with a fixed now is deterministic even with future/zero timestamps (correct)", () => {
    const rows: IdeaStat[] = [
      { ...base, id: "honest", score: 0, createdAt: 100 },
      { ...base, id: "future", score: 0, createdAt: 9_999_999_999 },
      { ...base, id: "zero", score: 0, createdAt: 0 },
    ];
    // 'new' is a plain createdAt desc; future sorts first, zero last. Deterministic + injectable now.
    expect(sortIdeaStats(rows, "new", now).map((r) => r.id)).toEqual(["future", "honest", "zero"]);
  });
});

// ---------------------------------------------------------------------------
// 11. Order-independence of the aggregate (CORRECT behavior we want to lock in).
// ---------------------------------------------------------------------------

describe("indexer: deriveBoardStats is insensitive to event ordering (correct)", () => {
  function corpus(): NostrEvent[] {
    return [
      boardEvent({ mods: [MOD] }),
      ideaEvent(IDEA1, A1, { createdAt: 100 }),
      ideaEvent(IDEA2, A2, { createdAt: 200 }),
      voteEvent(IDEA1, V1, "up", { createdAt: 110, id: "0a".repeat(32) }),
      voteEvent(IDEA1, V2, "up", { createdAt: 111, id: "0b".repeat(32) }),
      voteEvent(IDEA2, V1, "down", { createdAt: 210, id: "0c".repeat(32) }),
      ev(buildStatus({ target: { id: IDEA1 }, board: BOARD, state: "planned", createdAt: 120 }), OWNER),
      ev(buildPin({ target: { id: IDEA2 }, board: BOARD, createdAt: 220 }), MOD),
    ];
  }

  function summary(events: NostrEvent[]) {
    const agg = deriveBoardStats(events);
    return agg.ideas
      .map((i) => `${i.id}:${i.score}:${i.status}:${i.pinned}`)
      .sort()
      .join("|");
  }

  it("same events shuffled into different orders produce identical stats", () => {
    const forward = corpus();
    const reversed = [...corpus()].reverse();
    expect(summary(forward)).toBe(summary(reversed));
  });

  it("two conflicting same-pubkey votes at equal created_at: lowest id wins, order-independent", () => {
    const board = boardEvent();
    const idea = ideaEvent(IDEA1, A1);
    const up = voteEvent(IDEA1, V1, "up", { createdAt: 110, id: "00".repeat(31) + "0a" });
    const down = voteEvent(IDEA1, V1, "down", { createdAt: 110, id: "00".repeat(31) + "0b" });
    const a = find(deriveBoardStats([board, idea, up, down]), IDEA1)?.score;
    const b = find(deriveBoardStats([board, idea, down, up]), IDEA1)?.score;
    expect(a).toBe(b);
    expect(a).toBe(1); // the upvote (lower id "...0a") wins
  });
});

// ---------------------------------------------------------------------------
// 12. Reaction content parsing (defining exactly which strings are upvotes) via the aggregate.
// ---------------------------------------------------------------------------

describe("indexer: reaction content edge cases through deriveBoardStats", () => {
  it("100 distinct-pubkey empty-content reactions are 100 free upvotes", () => {
    const board = boardEvent();
    const idea = ideaEvent(IDEA1, A1);
    const reactions: NostrEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const pk = i.toString(16).padStart(2, "0").repeat(32);
      reactions.push(raw({ kind: KIND.Reaction, pubkey: pk, content: "", created_at: 100 + i, tags: [["e", IDEA1]] }));
    }
    const agg = deriveBoardStats([board, idea, ...reactions]);
    // Each distinct pubkey contributes one upvote (content === "" is treated as "up"). No WoT in M1.
    expect(find(agg, IDEA1)?.up).toBe(100);
    expect(find(agg, IDEA1)?.score).toBe(100);
  });

  it("NBSP-prefixed '+' trims to an upvote, '+1' is not a vote", () => {
    const board = boardEvent();
    const idea = ideaEvent(IDEA1, A1);
    // U+00A0 + "+" : JS String.trim() strips NBSP, so this counts as an upvote.
    const nbspPlus = raw({ kind: KIND.Reaction, pubkey: V1, content: " +", created_at: 100, tags: [["e", IDEA1]] });
    // "+1" is NOT a vote (parseVote returns null), so it does not count.
    const plusOne = raw({ kind: KIND.Reaction, pubkey: V2, content: "+1", created_at: 100, tags: [["e", IDEA1]] });
    const agg = deriveBoardStats([board, idea, nbspPlus, plusOne]);
    expect(find(agg, IDEA1)?.up).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13. Vote with multiple e-tags: parseVote credits ONLY the last e-tag.
// ---------------------------------------------------------------------------

describe("indexer: a multi-e-tag reaction counts for the LAST e-tag only", () => {
  it("a reaction listing idea A first and idea B last counts for B, never A", () => {
    const board = boardEvent();
    const ideaA = ideaEvent(IDEA1, A1);
    const ideaB = ideaEvent(IDEA2, A2);
    const reaction = raw({
      kind: KIND.Reaction,
      pubkey: V1,
      content: "+",
      created_at: 100,
      tags: [["e", IDEA1, "", A1], ["e", IDEA2, "", A2]], // A first, B last
    });
    const agg = deriveBoardStats([board, ideaA, ideaB, reaction]);
    expect(find(agg, IDEA1)?.score).toBe(0); // A is NOT the last e-tag
    expect(find(agg, IDEA2)?.score).toBe(1); // B is the last e-tag
  });
});

// ---------------------------------------------------------------------------
// 14. parseVote.targetAuthor is taken verbatim from the e-tag's 4th element (forgeable).
// ---------------------------------------------------------------------------

describe("indexer: vote targetAuthor is unverified decoration", () => {
  it("the 4th e-tag element is stored verbatim and never cross-checked against the idea author", () => {
    // Idea by A1, but the reaction's e-tag lies that the author is MALLORY.
    const reaction = raw({
      kind: KIND.Reaction,
      pubkey: V1,
      content: "+",
      created_at: 100,
      tags: [["e", IDEA1, "", MALLORY]],
    });
    const vote = parseVote(reaction)!;
    expect(vote.targetId).toBe(IDEA1); // the vote still counts for the real idea id
    expect(vote.targetAuthor).toBe(MALLORY); // ...but targetAuthor is the attacker-chosen value
  });
});

// ---------------------------------------------------------------------------
// 15. parseStatus target selection with multiple e-tags (first non-duplicate-of wins).
// ---------------------------------------------------------------------------

describe("indexer: parseStatus picks the first non-duplicate-of e-tag", () => {
  it("two plain e-tags: the FIRST is the target, the second is silently ignored", () => {
    const label = raw({
      kind: KIND.Label,
      pubkey: OWNER,
      created_at: 100,
      tags: [
        ["L", LABEL_NS.status],
        ["l", "planned", LABEL_NS.status],
        ["e", IDEA1],
        ["e", IDEA2],
        ["a", COORD],
      ],
    });
    expect(parseStatus(label)?.targetId).toBe(IDEA1);
  });

  it("a duplicate-of e-tag placed first does not become the target", () => {
    const label = raw({
      kind: KIND.Label,
      pubkey: OWNER,
      created_at: 100,
      tags: [
        ["L", LABEL_NS.status],
        ["l", "duplicate", LABEL_NS.status],
        ["e", IDEA2, "", "duplicate-of"], // duplicate-of placed FIRST
        ["e", IDEA1], // the real target
        ["a", COORD],
      ],
    });
    const status = parseStatus(label)!;
    expect(status.targetId).toBe(IDEA1);
    expect(status.duplicateOf).toBe(IDEA2);
  });
});

// ---------------------------------------------------------------------------
// 16. Reply cycles / orphans through deriveBoardStats (correct: unreachable subtrees drop).
// ---------------------------------------------------------------------------

describe("indexer: orphan/cycle replies do not inflate replyCount", () => {
  it("only replies reachable from the idea count; orphans and cycles contribute 0", () => {
    const board = boardEvent();
    const idea = ideaEvent(IDEA1, A1);
    const r1 = replyEvent("a1".repeat(32), IDEA1, A2, { createdAt: 110 });
    const r2 = replyEvent("a2".repeat(32), "a1".repeat(32), A2, { createdAt: 120 });
    const orphan = replyEvent("a3".repeat(32), "zz".repeat(32), A2, { createdAt: 130 });
    const cyc1 = replyEvent("c1".repeat(32), "c2".repeat(32), A2, { createdAt: 140 });
    const cyc2 = replyEvent("c2".repeat(32), "c1".repeat(32), A2, { createdAt: 150 });
    const agg = deriveBoardStats([board, idea, r1, r2, orphan, cyc1, cyc2]);
    // Only R1 and R2 are reachable from IDEA1.
    expect(find(agg, IDEA1)?.replyCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 17. Moderator demotion: authority resolves against the NEWEST board only (board-freshness driven).
// ---------------------------------------------------------------------------

describe("indexer: moderator authority follows the newest board version", () => {
  const v1 = boardEvent({ name: "V1", mods: [MOD], createdAt: 100, id: "01".repeat(32) });
  const v2 = boardEvent({ name: "V2", mods: [], createdAt: 200, id: "02".repeat(32) });
  const idea = ideaEvent(IDEA1, A1);
  const modStatus = ev(
    buildStatus({ target: { id: IDEA1 }, board: BOARD, state: "planned", createdAt: 120 }),
    MOD,
  );

  it("with the newer board present (MOD removed), MOD's earlier status is dropped", () => {
    const agg = deriveBoardStats([v1, v2, idea, modStatus]);
    expect(find(agg, IDEA1)?.status).toBeNull();
  });

  it("if the newer board is lost to a backfill gap, MOD's status is honored again", () => {
    // Same event corpus minus V2 (the demotion). Authority resolves against V1, which still lists MOD.
    const agg = deriveBoardStats([v1, idea, modStatus]);
    expect(find(agg, IDEA1)?.status).toBe("planned");
  });
});

// ---------------------------------------------------------------------------
// 18. Idea-id collision: a reply whose parentId equals an idea id attaches with no coordinate check.
// ---------------------------------------------------------------------------

describe("indexer: replies attach purely on parentId, with no per-board cross-check", () => {
  it("a reply carrying this board's A coordinate and parentId = an idea id inflates that idea's replyCount", () => {
    const board = boardEvent();
    const idea = ideaEvent(IDEA1, A1);
    // A forged-but-validly-shaped reply that points at IDEA1 as its parent. buildThread keys purely
    // on parentId === rootId; there is no check that the parent event actually belongs to this thread.
    const reply = replyEvent("ab".repeat(32), IDEA1, MALLORY, { createdAt: 110 });
    const agg = deriveBoardStats([board, idea, reply]);
    expect(find(agg, IDEA1)?.replyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 19. Category tag filtering is exact-string (case/whitespace sensitive).
// ---------------------------------------------------------------------------

describe("indexer: tag filter is exact-match, case and whitespace sensitive", () => {
  it("?tag=bug matches only the exact 'bug' category, not 'Bug'", () => {
    const board = boardEvent();
    const ideaBugLower = ideaEvent(IDEA1, A1, { categories: ["bug"] });
    const ideaBugUpper = ideaEvent(IDEA2, A2, { categories: ["Bug"] });
    const agg = deriveBoardStats([board, ideaBugLower, ideaBugUpper]);
    const matched = visibleIdeas(agg, { tag: "bug" }).map((i) => i.id);
    expect(matched).toContain(IDEA1);
    expect(matched).not.toContain(IDEA2); // 'Bug' is a distinct category from 'bug'
  });
});

// ---------------------------------------------------------------------------
// 20. No board -> everything visible, no labels honored (parse path when 34550 is missing).
// ---------------------------------------------------------------------------

describe("indexer: with no board definition, no moderation is honored", () => {
  it("statuses/pins/hides/bans are all ignored and all ideas are visible when board is null", () => {
    // No 34550 in the corpus, so board === null and every label-derived set is empty.
    const idea1 = ideaEvent(IDEA1, A1);
    const idea2 = ideaEvent(IDEA2, A2);
    const hide = ev(buildHide({ target: { id: IDEA1 }, board: BOARD, createdAt: 200 }), OWNER);
    const ban = ev(buildBan({ subject: A2, board: BOARD, createdAt: 200 }), OWNER);
    const status = ev(buildStatus({ target: { id: IDEA1 }, board: BOARD, state: "planned", createdAt: 200 }), OWNER);
    const agg = deriveBoardStats([idea1, idea2, hide, ban, status]);
    expect(agg.board).toBeNull();
    expect(agg.hidden.size).toBe(0);
    expect(agg.banned.size).toBe(0);
    expect(find(agg, IDEA1)?.status).toBeNull();
    expect(visibleIdeas(agg).map((i) => i.id).sort()).toEqual([IDEA1, IDEA2].sort());
  });
});
