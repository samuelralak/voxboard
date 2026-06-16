import { describe, it, expect } from "vitest";
import type { NostrEvent } from "../src/event";
import { KIND, MODERATION_MODE } from "../src/kinds";
import { buildIdea, isIdeaEvent, parseIdea } from "../src/idea";
import { buildReply, isReplyEvent, parseReply, type Reply } from "../src/reply";
import { parseVote, tallyVotes, tallyVotesByTarget } from "../src/vote";
import { parseDelete, deletedEventIds } from "../src/delete";
import { buildThread, countThread, partitionBoardEvents, replyCountsByRoot } from "../src/thread";
import { parseCommunityCoordinate, communityCoordinate } from "../src/coords";
import { buildBoard, parseBoard } from "../src/board";
import { buildStatus } from "../src/status";
import { buildApproval } from "../src/approval";
import { buildBan, buildHide, buildLock, buildPin, buildUnpin } from "../src/moderation";
import { deriveBoardStats, visibleIdeas } from "../src/aggregate";

const SIG = "0".repeat(128);
const OWNER = "a1".repeat(32);
const ALICE = "b2".repeat(32);
const BOB = "c3".repeat(32);
const MALLORY = "d4".repeat(32);
const SLUG = "vox";
const BOARD = { pubkey: OWNER, slug: SLUG };
const COORD = communityCoordinate(BOARD); // 34550:OWNER:vox

let n = 1;
function raw(o: Partial<NostrEvent> & { kind: number }): NostrEvent {
  return {
    id: o.id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    pubkey: o.pubkey ?? ALICE,
    sig: SIG,
    kind: o.kind,
    content: o.content ?? "",
    created_at: o.created_at ?? 1000,
    tags: o.tags ?? [],
  };
}
const ev = (template: { kind: number; created_at: number; tags: string[][]; content: string }, pubkey: string, id?: string): NostrEvent =>
  ({ ...template, pubkey, id: id ?? `id${(n++).toString(16).padStart(61, "0")}`, sig: SIG });

// A kind-7 reaction with explicit content + target.
function reaction(content: string, targetId: string, pubkey: string, opts: { createdAt?: number; id?: string; extraE?: string[] } = {}): NostrEvent {
  const tags: string[][] = [];
  if (opts.extraE) tags.push(["e", opts.extraE[0]!]);
  tags.push(["e", targetId, "", ALICE], ["p", ALICE], ["k", "1111"]);
  return raw({ kind: KIND.Reaction, content, pubkey, tags, created_at: opts.createdAt ?? 1000, id: opts.id });
}

describe("adversarial: votes / NIP-25", () => {
  it("empty content counts as an upvote", () => {
    expect(parseVote(reaction("", "t", BOB))?.direction).toBe("up");
  });
  it("'+' is up, '-' is down, whitespace is trimmed", () => {
    expect(parseVote(reaction("+", "t", BOB))?.direction).toBe("up");
    expect(parseVote(reaction("-", "t", BOB))?.direction).toBe("down");
    expect(parseVote(reaction("  + ", "t", BOB))?.direction).toBe("up");
    expect(parseVote(reaction(" - ", "t", BOB))?.direction).toBe("down");
  });
  it("emoji / custom reactions are NOT votes", () => {
    for (const c of ["🤙", "👍", "❤️", "🔥", "++", "+1", "yes", "-1"]) {
      expect(parseVote(reaction(c, "t", BOB)), `content ${c}`).toBeNull();
    }
  });
  it("a kind-7 with no e-tag is not a vote", () => {
    expect(parseVote(raw({ kind: KIND.Reaction, content: "+", tags: [["p", ALICE]] }))).toBeNull();
  });
  it("a non-reaction kind is not a vote", () => {
    expect(parseVote(raw({ kind: 1, content: "+", tags: [["e", "t"]] }))).toBeNull();
  });
  it("the LAST e-tag is the target", () => {
    const v = parseVote(reaction("+", "real-target", BOB, { extraE: ["decoy"] }));
    expect(v?.targetId).toBe("real-target");
  });
  it("latest-per-pubkey wins: up then a later down -> down", () => {
    const votes = [
      parseVote(reaction("+", "t", BOB, { createdAt: 1 }))!,
      parseVote(reaction("-", "t", BOB, { createdAt: 2 }))!,
    ];
    const tally = tallyVotes(votes);
    expect(tally).toMatchObject({ up: 0, down: 1, score: -1 });
    expect(tally.byPubkey.get(BOB)).toBe("down");
  });
  it("same created_at tie is broken by lowest id (deterministic, order-independent)", () => {
    const up = parseVote(reaction("+", "t", BOB, { createdAt: 5, id: "id" + "a".repeat(62) }))!;
    const down = parseVote(reaction("-", "t", BOB, { createdAt: 5, id: "id" + "f".repeat(62) }))!;
    expect(tallyVotes([up, down]).score).toBe(tallyVotes([down, up]).score); // order-independent
    expect(tallyVotes([up, down]).byPubkey.get(BOB)).toBe("up"); // "id aaa..." < "id fff..."
  });
  it("three distinct pubkeys upvoting -> score 3", () => {
    const votes = [ALICE, BOB, MALLORY].map((p) => parseVote(reaction("+", "t", p))!);
    expect(tallyVotes(votes).score).toBe(3);
  });
  it("tallyVotesByTarget groups by target id", () => {
    const votes = [
      parseVote(reaction("+", "A", ALICE))!,
      parseVote(reaction("+", "A", BOB))!,
      parseVote(reaction("-", "B", ALICE))!,
    ];
    const map = tallyVotesByTarget(votes);
    expect(map.get("A")?.score).toBe(2);
    expect(map.get("B")?.score).toBe(-1);
  });
});

describe("adversarial: NIP-09 deletions", () => {
  const idea = ev(buildIdea({ board: BOARD, title: "Mine" }), ALICE, "ALICE_IDEA");
  it("an author can delete their own event", () => {
    const del = raw({ kind: KIND.Delete, pubkey: ALICE, tags: [["e", "ALICE_IDEA"], ["k", "1111"]] });
    const hidden = deletedEventIds([parseDelete(del)!], [idea]);
    expect(hidden.has("ALICE_IDEA")).toBe(true);
  });
  it("you CANNOT delete someone else's event (same-author rule)", () => {
    const del = raw({ kind: KIND.Delete, pubkey: MALLORY, tags: [["e", "ALICE_IDEA"], ["k", "1111"]] });
    const hidden = deletedEventIds([parseDelete(del)!], [idea]);
    expect(hidden.has("ALICE_IDEA")).toBe(false);
  });
  it("a delete with mixed-author targets only hides the deleter's own", () => {
    const mine = ev(buildIdea({ board: BOARD, title: "Mine" }), MALLORY, "M_IDEA");
    const theirs = ev(buildIdea({ board: BOARD, title: "Theirs" }), ALICE, "A_IDEA");
    const del = raw({ kind: KIND.Delete, pubkey: MALLORY, tags: [["e", "M_IDEA"], ["e", "A_IDEA"], ["k", "1111"]] });
    const hidden = deletedEventIds([parseDelete(del)!], [mine, theirs]);
    expect(hidden.has("M_IDEA")).toBe(true);
    expect(hidden.has("A_IDEA")).toBe(false);
  });
  it("a delete with no e/a tags parses to null (no effect)", () => {
    expect(parseDelete(raw({ kind: KIND.Delete, tags: [["k", "1111"]] }))).toBeNull();
  });
  it("deleting an id not present is a no-op", () => {
    const del = raw({ kind: KIND.Delete, pubkey: ALICE, tags: [["e", "ghost"]] });
    expect(deletedEventIds([parseDelete(del)!], [idea]).size).toBe(0);
  });
  it("addressable (a-tag) delete: older replacement survives a newer delete by created_at", () => {
    const board = ev(buildBoard({ slug: SLUG, name: "B" }), OWNER, "BOARD_V");
    const olderDelete = raw({ kind: KIND.Delete, pubkey: OWNER, created_at: 50, tags: [["a", COORD]] });
    // board.created_at (default from buildBoard = now) is AFTER 50, so it survives
    const survivingBoard = { ...board, created_at: 100 };
    const hidden = deletedEventIds([parseDelete(olderDelete)!], [survivingBoard]);
    expect(hidden.has("BOARD_V")).toBe(false);
    // but a delete at/after the board's created_at hides it
    const newerDelete = raw({ kind: KIND.Delete, pubkey: OWNER, created_at: 100, tags: [["a", COORD]] });
    expect(deletedEventIds([parseDelete(newerDelete)!], [survivingBoard]).has("BOARD_V")).toBe(true);
  });
});

describe("adversarial: thread building", () => {
  // buildThread takes PARSED Reply objects (as the read path does: partitionBoardEvents -> buildThread).
  const reply = (id: string, parentId: string, pubkey = ALICE, createdAt = 1000): Reply =>
    parseReply(ev(buildReply({ board: BOARD, parent: { id: parentId, pubkey: BOB, kind: 1111 }, body: id, createdAt }), pubkey, id))!;

  it("a self-referential reply (parent = itself) does not loop and is dropped from the idea tree", () => {
    const tree = buildThread("IDEA", [reply("R1", "R1")]);
    expect(tree).toHaveLength(0);
    expect(countThread(tree)).toBe(0);
  });
  it("a 2-cycle (A->B->A) with no path to root is dropped, no infinite recursion", () => {
    const replies = [reply("A", "B"), reply("B", "A")];
    expect(() => buildThread("IDEA", replies)).not.toThrow();
    expect(countThread(buildThread("IDEA", replies))).toBe(0);
  });
  it("an orphan reply (unknown parent) is dropped", () => {
    expect(buildThread("IDEA", [reply("R", "missing-parent")])).toHaveLength(0);
  });
  it("deep nesting builds correctly and counts all descendants", () => {
    const replies: Reply[] = [];
    let parent = "IDEA";
    for (let i = 0; i < 60; i++) {
      const id = `D${i}`;
      replies.push(reply(id, parent));
      parent = id;
    }
    const tree = buildThread("IDEA", replies);
    expect(countThread(tree)).toBe(60);
    let depth = 0;
    let node = tree[0];
    while (node) { depth++; node = node.children[0]; }
    expect(depth).toBe(60);
  });
  it("sibling replies with identical created_at are ordered by id ascending", () => {
    const tree = buildThread("IDEA", [reply("Zzz", "IDEA", ALICE, 500), reply("Aaa", "IDEA", BOB, 500)]);
    expect(tree.map((n) => n.reply.id)).toEqual(["Aaa", "Zzz"]);
  });
  it("replyCountsByRoot (O(roots+replies)) matches per-idea buildThread/countThread", () => {
    const replies = [reply("a", "IDEA1"), reply("b", "a"), reply("c", "b"), reply("d", "IDEA2")];
    const counts = replyCountsByRoot(["IDEA1", "IDEA2"], replies);
    expect(counts.get("IDEA1")).toBe(3);
    expect(counts.get("IDEA2")).toBe(1);
    for (const root of ["IDEA1", "IDEA2"]) {
      expect(counts.get(root)).toBe(countThread(buildThread(root, replies)));
    }
  });
  it("replyCountsByRoot terminates on a cycle and counts each reply once", () => {
    const replies = [reply("X", "Y"), reply("Y", "X")];
    expect(() => replyCountsByRoot(["IDEA"], replies)).not.toThrow();
    expect(replyCountsByRoot(["IDEA"], replies).get("IDEA")).toBe(0);
  });
});

describe("adversarial: idea / reply disambiguation", () => {
  it("a kind-1111 reply (parent is a 1111 comment) is a REPLY, not an idea", () => {
    const reply = ev(buildReply({ board: BOARD, parent: { id: "P", pubkey: BOB, kind: 1111 }, body: "hi" }), ALICE);
    expect(isReplyEvent(reply)).toBe(true);
    expect(isIdeaEvent(reply)).toBe(false);
    expect(parseIdea(reply)).toBeNull();
  });
  it("INTEROP: a top-level idea that e-references the community definition event is an IDEA, not a reply", () => {
    // Real NIP-22 clients (Amethyst) tag a top-level community post with A/a (=coord), K/k (=34550),
    // AND e/E (=the community 34550 event). The PARENT KIND is the discriminator, not the e-tag.
    const idea = raw({
      kind: KIND.Comment,
      pubkey: ALICE,
      content: "windir - my journey to the end",
      tags: [
        ["A", COORD], ["K", "34550"], ["P", OWNER], ["E", "deadbeef".repeat(8)],
        ["a", COORD], ["k", "34550"], ["p", OWNER], ["e", "deadbeef".repeat(8)],
        ["t", "metal"],
      ],
    });
    expect(isIdeaEvent(idea)).toBe(true);
    expect(isReplyEvent(idea)).toBe(false);
    const parsed = parseIdea(idea);
    expect(parsed?.title).toBe("windir - my journey to the end");
    expect(parsed?.categories).toEqual(["metal"]);
    const { ideas, replies } = partitionBoardEvents([idea]);
    expect(ideas).toHaveLength(1);
    expect(replies).toHaveLength(0);
  });
  it("a kind-1111 with no A tag is neither idea nor reply", () => {
    const orphan = raw({ kind: KIND.Comment, tags: [["subject", "no scope"]] });
    expect(isIdeaEvent(orphan)).toBe(false);
    expect(isReplyEvent(orphan)).toBe(false);
    const { ideas, replies } = partitionBoardEvents([orphan]);
    expect(ideas).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
  it("a kind-1111 whose parent (a) is NOT the community is not an idea", () => {
    const idea = ev(buildIdea({ board: BOARD, title: "x" }), ALICE);
    const tampered = { ...idea, tags: idea.tags.map((t) => (t[0] === "a" ? ["a", "34550:other:slug"] : t)) };
    expect(isIdeaEvent(tampered)).toBe(false);
  });
  it("idea with empty subject falls back to first line of content", () => {
    const idea = ev(buildIdea({ board: BOARD, title: "", body: "First line\nsecond line" }), ALICE);
    expect(parseIdea(idea)?.title).toBe("First line");
  });
  it("duplicate category tags are deduped", () => {
    const idea = ev(buildIdea({ board: BOARD, title: "x", categories: ["feature", "feature", "bug"] }), ALICE);
    expect(parseIdea(idea)?.categories).toEqual(["feature", "bug"]);
  });
});

describe("adversarial: coordinates", () => {
  it("round-trips", () => {
    expect(parseCommunityCoordinate(COORD)).toEqual(BOARD);
  });
  it("a slug containing colons is preserved", () => {
    const ref = parseCommunityCoordinate(`34550:${OWNER}:a:b:c`);
    expect(ref?.slug).toBe("a:b:c");
  });
  it("rejects malformed coordinates", () => {
    for (const bad of ["34550:", `34550:${OWNER}`, ":x:y", "", "34550", `1:${OWNER}:x`, `34550:short:x`]) {
      expect(parseCommunityCoordinate(bad), bad).toBeNull();
    }
  });
});

describe("adversarial: board parsing", () => {
  it("a board missing its name is rejected", () => {
    const noName = raw({ kind: KIND.Community, pubkey: OWNER, tags: [["d", SLUG]] });
    expect(parseBoard(noName)).toBeNull();
  });
  it("a board missing its d tag is rejected", () => {
    const noD = raw({ kind: KIND.Community, pubkey: OWNER, tags: [["name", "X"]] });
    expect(parseBoard(noD)).toBeNull();
  });
  it("only p-tags marked 'moderator' grant moderation authority", () => {
    const board = raw({
      kind: KIND.Community, pubkey: OWNER,
      tags: [["d", SLUG], ["name", "X"], ["p", ALICE, "", "moderator"], ["p", BOB], ["p", MALLORY, "", "admin"]],
    });
    const parsed = parseBoard(board);
    expect(parsed?.moderators.map((m) => m.pubkey)).toEqual([ALICE]);
  });
});

describe("adversarial: deriveBoardStats deletion-awareness (indexer parity)", () => {
  it("honors a NIP-09 self-delete of an idea", () => {
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Keep" }), ALICE, "KEEP"),
      ev(buildIdea({ board: BOARD, title: "Retract me" }), BOB, "GONE"),
      raw({ kind: KIND.Delete, pubkey: BOB, created_at: 9999, tags: [["e", "GONE"], ["k", "1111"]] }),
    ];
    const agg = deriveBoardStats(events);
    const ids = agg.ideas.map((i) => i.id);
    expect(ids).toContain("KEEP");
    expect(ids).not.toContain("GONE"); // a retracted idea must not appear in the aggregate
  });
  it("honors a NIP-09 self-retraction of a vote", () => {
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Idea" }), ALICE, "IDEA"),
      reaction("+", "IDEA", BOB, { id: "VOTE", createdAt: 10 }),
      raw({ kind: KIND.Delete, pubkey: BOB, created_at: 20, tags: [["e", "VOTE"], ["k", "7"]] }),
    ];
    const agg = deriveBoardStats(events);
    const idea = agg.ideas.find((i) => i.id === "IDEA");
    expect(idea?.score).toBe(0); // the retracted upvote must not count
  });
});

describe("M3: read-time moderation enforcement (deriveBoardStats / visibleIdeas)", () => {
  const board = () => ev(buildBoard({ slug: SLUG, name: "B" }), OWNER);
  const curatedBoard = () => ev(buildBoard({ slug: SLUG, name: "B", mode: MODERATION_MODE.curated }), OWNER);
  const idea = (id: string, author: string) => ev(buildIdea({ board: BOARD, title: id }), author, id);
  const reply = (id: string, parentId: string, author: string, createdAt = 1000) =>
    ev(buildReply({ board: BOARD, parent: { id: parentId, pubkey: ALICE, kind: 1111 }, body: id, createdAt }), author, id);

  it("a banned author's upvote does not count toward an idea's score", () => {
    const events = [
      board(), idea("IDEA", ALICE),
      reaction("+", "IDEA", BOB, { id: "v1" }),
      reaction("+", "IDEA", MALLORY, { id: "v2" }),
      ev(buildBan({ subject: MALLORY, board: BOARD }), OWNER),
    ];
    expect(deriveBoardStats(events).ideas.find((i) => i.id === "IDEA")?.score).toBe(1);
  });

  it("a banned author's reply does not count toward replyCount", () => {
    const events = [
      board(), idea("IDEA", ALICE),
      reply("r1", "IDEA", BOB), reply("r2", "IDEA", MALLORY),
      ev(buildBan({ subject: MALLORY, board: BOARD }), OWNER),
    ];
    expect(deriveBoardStats(events).ideas.find((i) => i.id === "IDEA")?.replyCount).toBe(1);
  });

  it("a hidden reply is excluded from replyCount", () => {
    const events = [
      board(), idea("IDEA", ALICE),
      reply("r1", "IDEA", BOB), reply("r2", "IDEA", BOB),
      ev(buildHide({ target: { id: "r2" }, board: BOARD }), OWNER),
    ];
    expect(deriveBoardStats(events).ideas.find((i) => i.id === "IDEA")?.replyCount).toBe(1);
  });

  it("a lock cutoff excludes replies created after the lock from the count", () => {
    const events = [
      board(), idea("IDEA", ALICE),
      reply("r1", "IDEA", BOB, 100), reply("r2", "IDEA", BOB, 300),
      ev(buildLock({ target: { id: "IDEA" }, board: BOARD, createdAt: 200 }), OWNER),
    ];
    expect(deriveBoardStats(events).ideas.find((i) => i.id === "IDEA")?.replyCount).toBe(1);
  });

  it("an explicit later 'unpinned' label clears a pin (pin off-state)", () => {
    const pinned = deriveBoardStats([
      board(), idea("IDEA", ALICE),
      ev(buildPin({ target: { id: "IDEA" }, board: BOARD, createdAt: 100 }), OWNER),
    ]);
    expect(pinned.ideas.find((i) => i.id === "IDEA")?.pinned).toBe(true);
    const unpinned = deriveBoardStats([
      board(), idea("IDEA", ALICE),
      ev(buildPin({ target: { id: "IDEA" }, board: BOARD, createdAt: 100 }), OWNER),
      ev(buildUnpin({ target: { id: "IDEA" }, board: BOARD, createdAt: 200 }), OWNER),
    ]);
    expect(unpinned.ideas.find((i) => i.id === "IDEA")?.pinned).toBe(false);
  });

  it("curated mode: only approved ideas (or owner/mod posts) are visible", () => {
    const ideaB = idea("IDEA_B", BOB);
    const events = [
      curatedBoard(),
      idea("IDEA_OWNER", OWNER), // mod post -> auto-approved
      idea("IDEA_A", ALICE), // unapproved
      ideaB, // approved via 4550
      ev(buildApproval({ board: BOARD, post: ideaB }), OWNER),
    ];
    const agg = deriveBoardStats(events);
    expect(agg.ideas.find((i) => i.id === "IDEA_A")?.approved).toBe(false);
    expect(agg.ideas.find((i) => i.id === "IDEA_B")?.approved).toBe(true);
    expect(agg.ideas.find((i) => i.id === "IDEA_OWNER")?.approved).toBe(true);
    const visibleIds = visibleIdeas(agg).map((i) => i.id);
    expect(visibleIds).toContain("IDEA_B");
    expect(visibleIds).toContain("IDEA_OWNER");
    expect(visibleIds).not.toContain("IDEA_A");
  });

  it("open mode: every idea is approved (no curation)", () => {
    const agg = deriveBoardStats([board(), idea("IDEA_A", ALICE), idea("IDEA_B", BOB)]);
    expect(agg.ideas.every((i) => i.approved)).toBe(true);
    expect(visibleIdeas(agg)).toHaveLength(2);
  });

  it("a status label scoped to ANOTHER board's coordinate is ignored (no cross-board leak)", () => {
    const events = [
      board(), idea("IDEA", ALICE),
      // owner authors a 'planned' status, but for a DIFFERENT board coordinate
      ev(buildStatus({ target: { id: "IDEA" }, board: { pubkey: OWNER, slug: "other-board" }, state: "planned" }), OWNER),
    ];
    expect(deriveBoardStats(events).ideas.find((i) => i.id === "IDEA")?.status).toBeNull();
  });

  it("an UNAUTHORIZED hide (random user) is ignored", () => {
    const events = [
      board(), idea("IDEA", ALICE),
      reply("r1", "IDEA", BOB),
      ev(buildHide({ target: { id: "r1" }, board: BOARD }), MALLORY), // not owner/mod
    ];
    expect(deriveBoardStats(events).ideas.find((i) => i.id === "IDEA")?.replyCount).toBe(1);
  });
});
