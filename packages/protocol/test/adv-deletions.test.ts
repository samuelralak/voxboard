/**
 * Adversarial coverage for the NIP-09 deletion subsystem (src/delete.ts) and its use inside the
 * shared aggregator (src/aggregate.ts).
 *
 * Scope: pure protocol-unit cases only. The e2e/app-layer cases (subscription scope, durability of
 * the hidden set across relays, in-app toggle state) live in the app suite and are catalogued in the
 * accompanying e2eCases report, not here.
 *
 * Conventions mirror test/adversarial.test.ts: a local `raw()` helper builds NIP-01-shaped events,
 * `ev()` wraps the build* templates, and identities are 64-hex pubkeys. Where the existing suite
 * already pins a behavior (basic same-author hide, mixed-author hide, no-tag parse-null, the simple
 * older-survives/newer-hides a-tag pair, and deriveBoardStats honoring single idea/vote deletes), we
 * do NOT repeat it; we extend into the forgery guards, the timestamp gate, over-deletion, and the
 * vote-tally interplay.
 *
 * Several cases assert the CORRECT protocol behavior even though the current code is wrong; those
 * tests are expected to FAIL and the underlying defects are listed in suspectedBugs. Each such block
 * is marked with a `BUG:` comment so the failure is intentional, not a flaky assertion.
 */

import { describe, it, expect } from "vitest";
import type { NostrEvent } from "../src/event";
import { KIND } from "../src/kinds";
import { buildIdea } from "../src/idea";
import { buildBoard } from "../src/board";
import { buildVote } from "../src/vote";
import { buildDelete, parseDelete, deletedEventIds, type Deletion } from "../src/delete";
import { parseVote, tallyVotesByTarget } from "../src/vote";
import { deriveBoardStats } from "../src/aggregate";

const SIG = "0".repeat(128);

// 64-hex identities.
const OWNER = "a1".repeat(32);
const MOD = "b2".repeat(32);
const POSTER = "c3".repeat(32);
const OUTSIDER = "d4".repeat(32);
const AUTHOR = "e5".repeat(32);

const SLUG = "vox";
const BOARD = { pubkey: OWNER, slug: SLUG };
const COORD = `34550:${OWNER}:${SLUG}`;

let n = 1;
function raw(o: Partial<NostrEvent> & { kind: number }): NostrEvent {
  return {
    id: o.id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    pubkey: o.pubkey ?? POSTER,
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

/** parseDelete a build* template signed by `pubkey`. */
const del = (input: Parameters<typeof buildDelete>[0], pubkey: string, id?: string): Deletion =>
  parseDelete(ev(buildDelete(input), pubkey, id))!;

/** A kind-7 reaction with explicit content/target/author so we can drive tally interplay. */
function reaction(
  content: string,
  targetId: string,
  pubkey: string,
  opts: { createdAt?: number; id?: string; targetAuthor?: string } = {},
): NostrEvent {
  return raw({
    kind: KIND.Reaction,
    content,
    pubkey,
    created_at: opts.createdAt ?? 1000,
    id: opts.id,
    tags: [["e", targetId, "", opts.targetAuthor ?? AUTHOR], ["k", "1111"]],
  });
}

// ---------------------------------------------------------------------------
// e-tag (event-id) deletions: the same-author forgery guard
// ---------------------------------------------------------------------------

describe("deletions: e-tag forgery guard", () => {
  it("an attacker cannot retract another user's upvote via an e-tag delete", () => {
    // OUTSIDER signs a delete naming a vote that POSTER authored. The id matches, but the author
    // does not, so idsByAuthor only has an entry under OUTSIDER and the vote is never matched.
    const vote = raw({
      kind: KIND.Reaction,
      id: "aa".repeat(32),
      pubkey: POSTER,
      created_at: 50,
      content: "+",
      tags: [["e", "tt".repeat(32), "", POSTER], ["k", "1111"]],
    });
    const d = del({ ids: ["aa".repeat(32)] }, OUTSIDER);
    const hidden = deletedEventIds([d], [vote]);
    expect(hidden.size).toBe(0);
    expect(hidden.has("aa".repeat(32))).toBe(false);
  });

  it("a delete naming both the deleter's own id and a foreign id hides only the deleter's", () => {
    // POSTER deletes their own idea M and (forging) MOD's idea T in one event.
    const mine = raw({ kind: KIND.Comment, id: "11".repeat(32), pubkey: POSTER, created_at: 100, tags: [["A", COORD]] });
    const theirs = raw({ kind: KIND.Comment, id: "22".repeat(32), pubkey: MOD, created_at: 100, tags: [["A", COORD]] });
    const d = del({ ids: ["11".repeat(32), "22".repeat(32)], kinds: [1111] }, POSTER);
    const hidden = deletedEventIds([d], [mine, theirs]);
    expect(hidden).toEqual(new Set(["11".repeat(32)]));
  });

  it("an idea author CANNOT delete another user's downvote on their own idea (no owner override)", () => {
    // Same-author rule cuts both ways: it blocks forged deletes AND leaves a victim unable to clear a
    // brigaded reaction via NIP-09. Abuse mitigation must live in the moderation (kind 1985) path.
    const hostileVote = raw({
      kind: KIND.Reaction,
      id: "vb".repeat(32),
      pubkey: MOD,
      created_at: 100,
      content: "-",
      tags: [["e", "idea1", "", AUTHOR], ["k", "1111"]],
    });
    const d = del({ ids: ["vb".repeat(32)] }, AUTHOR); // idea author tries to nuke the downvote
    const hidden = deletedEventIds([d], [hostileVote]);
    expect(hidden.has("vb".repeat(32))).toBe(false);
    const tally = tallyVotesByTarget([parseVote(hostileVote)!].filter((v) => !hidden.has(v.id))).get("idea1");
    expect(tally?.score).toBe(-1); // the downvote still stands
  });
});

// ---------------------------------------------------------------------------
// e-tag deletions: id-specificity and permanence
// ---------------------------------------------------------------------------

describe("deletions: e-tag id semantics", () => {
  it("re-publishing the same content with a NEW id survives an e-tag delete", () => {
    const i1 = raw({ kind: KIND.Comment, id: "11".repeat(32), pubkey: POSTER, created_at: 100, tags: [["A", COORD]] });
    const i2 = raw({ kind: KIND.Comment, id: "33".repeat(32), pubkey: POSTER, created_at: 300, tags: [["A", COORD]] });
    const d = del({ ids: ["11".repeat(32)] }, POSTER);
    const hidden = deletedEventIds([d], [i1, i2]);
    expect(hidden).toEqual(new Set(["11".repeat(32)])); // only the exact deleted id; the re-post is live
  });

  it("re-broadcasting the IDENTICAL id after an e-tag delete stays hidden permanently (timestamp-irrelevant)", () => {
    // The e-path never consults created_at, so the delete-vs-republish ordering does not matter: the
    // id is tombstoned for good and only a fresh re-signed event (new id) can escape.
    const i1Early = raw({ kind: KIND.Comment, id: "i1".repeat(32), pubkey: POSTER, created_at: 100, tags: [["A", COORD]] });
    const i1Late = { ...i1Early, created_at: 9_999 }; // re-broadcast "after" the delete
    const d = del({ ids: ["i1".repeat(32)] }, POSTER, undefined);
    expect(deletedEventIds([d], [i1Early]).has("i1".repeat(32))).toBe(true);
    expect(deletedEventIds([d], [i1Late]).has("i1".repeat(32))).toBe(true);
  });

  it("a delete of a delete is a no-op: deletions are never themselves candidates, so they cannot be revoked", () => {
    const idea = raw({ kind: KIND.Comment, id: "11".repeat(32), pubkey: POSTER, created_at: 100, tags: [["A", COORD]] });
    const d1 = del({ ids: ["11".repeat(32)] }, POSTER, "de".repeat(32)); // hides the idea
    const d2 = del({ ids: ["de".repeat(32)] }, POSTER); // tries to retract d1
    // Only content events are candidates; D1 (id "de"*32) is not in the candidate list.
    const hidden = deletedEventIds([d1, d2], [idea]);
    expect(hidden).toEqual(new Set(["11".repeat(32)])); // the original stays hidden; deletions are monotonic
  });

  it("e-tag delete is pure id-match and ignores the k kind hint (no kind cross-check)", () => {
    // The k hint says kind 7, but the candidate sharing that id is a kind-1111 idea by the same
    // author. parseDelete records kinds, but deletedEventIds never reads them, so the idea is hidden.
    const d = del({ ids: ["collide"], kinds: [7] }, AUTHOR);
    expect(d.kinds).toEqual([7]);
    const ideaCollide = raw({ kind: KIND.Comment, id: "collide", pubkey: AUTHOR, created_at: 100, tags: [["A", COORD]] });
    const hidden = deletedEventIds([d], [ideaCollide]);
    expect(hidden.has("collide")).toBe(true); // k hint is decorative; id-match alone decides
  });

  it("a delete referencing many ids hides exactly the author's referenced subset, across kinds", () => {
    const d = del({ ids: ["p1".repeat(32), "p2".repeat(32), "p3".repeat(32), "x9".repeat(32)] }, POSTER);
    const p1 = raw({ kind: KIND.Comment, id: "p1".repeat(32), pubkey: POSTER, tags: [["A", COORD]] });
    const p2 = raw({ kind: KIND.Comment, id: "p2".repeat(32), pubkey: POSTER, tags: [["A", COORD]] });
    const p3 = raw({ kind: KIND.Reaction, id: "p3".repeat(32), pubkey: POSTER, content: "+", tags: [["e", "t".repeat(32)]] });
    const foreign = raw({ kind: KIND.Comment, id: "x9".repeat(32), pubkey: MOD, tags: [["A", COORD]] }); // listed but not POSTER's
    const unref = raw({ kind: KIND.Comment, id: "z0".repeat(32), pubkey: POSTER, tags: [["A", COORD]] }); // POSTER's but not named
    const hidden = deletedEventIds([d], [p1, p2, p3, foreign, unref]);
    expect(hidden).toEqual(new Set(["p1".repeat(32), "p2".repeat(32), "p3".repeat(32)]));
  });
});

// ---------------------------------------------------------------------------
// a-tag (addressable coordinate) deletions: timestamp gate
// ---------------------------------------------------------------------------

describe("deletions: a-tag timestamp gate", () => {
  it("a strictly-older addressable target is hidden and a strictly-newer replacement survives one delete", () => {
    const older = ev({ ...buildBoard({ slug: SLUG, name: "old" }), created_at: 100 }, OWNER, "a0".repeat(32));
    const newer = ev({ ...buildBoard({ slug: SLUG, name: "new" }), created_at: 300 }, OWNER, "b0".repeat(32));
    const d = del({ coords: [COORD], kinds: [34550], createdAt: 200 }, OWNER);
    const hidden = deletedEventIds([d], [older, newer]);
    expect(hidden).toEqual(new Set(["a0".repeat(32)]));
  });

  it("multiple a-tag deletes for one coord keep the MAX created_at, order-independently", () => {
    // D1@100, D2@300 over the same coord; a target stamped 200 sits between them. The reducer keeps
    // max(100,300)=300, so 200<=300 hides it regardless of which delete is seen first.
    const d1 = del({ coords: ["30000:" + OWNER + ":k"], createdAt: 100 }, OWNER);
    const d2 = del({ coords: ["30000:" + OWNER + ":k"], createdAt: 300 }, OWNER);
    const followSet = raw({ kind: KIND.FollowSet, id: "f9".repeat(32), pubkey: OWNER, created_at: 200, tags: [["d", "k"]] });
    expect(deletedEventIds([d1, d2], [followSet]).has("f9".repeat(32))).toBe(true);
    expect(deletedEventIds([d2, d1], [followSet]).has("f9".repeat(32))).toBe(true);
    // Had only D1 existed, 200<=100 is false and the target would survive.
    expect(deletedEventIds([d1], [followSet]).has("f9".repeat(32))).toBe(false);
  });

  it("a delete carrying BOTH e and a tags applies each rule independently", () => {
    // Pin the delete's created_at to 100 so the a-tag gate is well-defined: set1@50 is hidden,
    // set2@1000 is a strictly-newer replacement and survives, while reply is hidden by exact id.
    const d = del({ ids: ["e1".repeat(32)], coords: ["30000:" + OWNER + ":roster"], kinds: [1111, 30000], createdAt: 100 }, OWNER);
    const reply = raw({ kind: KIND.Comment, id: "e1".repeat(32), pubkey: OWNER, created_at: 50, tags: [["A", COORD], ["e", "x"]] });
    const set1 = raw({ kind: KIND.FollowSet, id: "s1".repeat(32), pubkey: OWNER, created_at: 50, tags: [["d", "roster"]] });
    const set2 = raw({ kind: KIND.FollowSet, id: "s2".repeat(32), pubkey: OWNER, created_at: 1000, tags: [["d", "roster"]] }); // newer survives
    const hidden = deletedEventIds([d], [reply, set1, set2]);
    expect(hidden).toEqual(new Set(["e1".repeat(32), "s1".repeat(32)]));
  });
});

// ---------------------------------------------------------------------------
// a-tag deletions: cross-author coordinate forgery guard
// ---------------------------------------------------------------------------

describe("deletions: a-tag forgery guard", () => {
  it("an a-tag delete quoting ANOTHER author's coordinate string cannot hide that author's event", () => {
    // OUTSIDER explicitly puts MOD's coordinate "30000:MOD:k" in the a-tag. The coord map is keyed by
    // the DELETION author (OUTSIDER); the candidate BSET reconstructs to "30000:MOD:k" and is looked
    // up under coordsByAuthor.get(MOD), which is undefined. The spoofed string is inert.
    const bset = raw({ kind: KIND.FollowSet, id: "f3".repeat(32), pubkey: MOD, created_at: 100, tags: [["d", "k"]] });
    const d = del({ coords: ["30000:" + MOD + ":k"], createdAt: 200 }, OUTSIDER);
    const hidden = deletedEventIds([d], [bset]);
    expect(hidden.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// a-tag deletions: over-deletion / timestamp defects (EXPECTED-FAIL)
// ---------------------------------------------------------------------------

describe("deletions: a-tag over-deletion and boundary defects", () => {
  it("BUG: an a-tag delete of a kind-1111 coord must NOT collapse every d-less comment by the author", () => {
    // NIP-09 a-deletes target addressable kinds (30000-39999, plus 0/3). Kind 1111 is a regular
    // event with no addressable identity, so all three d-less comments collapse to the same coord
    // "1111:POSTER:" and a single coordinate delete wipes the author's whole comment history.
    // Correct behavior: the a-tag branch must not match non-addressable kind 1111 at all, so deleting
    // one specific post leaves the others visible. The reply re1/re2 here were NOT individually named.
    const idea = raw({ kind: KIND.Comment, id: "f0".repeat(32), pubkey: POSTER, created_at: 100, tags: [["A", COORD]] });
    const reply1 = raw({ kind: KIND.Comment, id: "f1".repeat(32), pubkey: POSTER, created_at: 150, tags: [["A", COORD], ["e", "f0".repeat(32)]] });
    const reply2 = raw({ kind: KIND.Comment, id: "f2".repeat(32), pubkey: POSTER, created_at: 200, tags: [["A", COORD], ["e", "f0".repeat(32)]] });
    const d = del({ coords: ["1111:" + POSTER + ":"], createdAt: 300 }, POSTER);
    const hidden = deletedEventIds([d], [idea, reply1, reply2]);
    // Asserting the SAFE outcome (no collateral wipe). Current code returns all three ids, so this
    // fails, pinning the over-deletion defect.
    expect(hidden.size).toBe(0);
  });

  it.todo("a future-dated a-tag delete must NOT tombstone replacements the author publishes later"); // M5

  it("BOUNDARY: an a-tag delete stamped exactly equal to the target's created_at hides it (inclusive <=)", () => {
    // Pinned, not flagged as a hard bug: NIP-09 deletes "up to and including" created_at, so equality
    // hiding is defensible. The usability hazard (a same-second delete-then-republish swallows the
    // fresh copy because it is not strictly newer) is documented in suspectedBugs as low severity.
    const target = ev({ ...buildBoard({ slug: SLUG, name: "same" }), created_at: 1000 }, OWNER, "t0".repeat(32));
    const d = del({ coords: [COORD], createdAt: 1000 }, OWNER);
    expect(deletedEventIds([d], [target]).has("t0".repeat(32))).toBe(true);
  });

  it.todo("duplicate 'd' tags must resolve to one deterministic coordinate, not depend on tag order"); // M5
});

// ---------------------------------------------------------------------------
// Malformed / hostile deletions
// ---------------------------------------------------------------------------

describe("deletions: malformed and hostile inputs", () => {
  it("a delete with an empty tags array parses to null", () => {
    expect(parseDelete(raw({ kind: KIND.Delete, pubkey: POSTER, tags: [] }))).toBeNull();
  });

  it("a delete with only a k tag (no e/a) parses to null and never deletes-all-of-a-kind", () => {
    const d = parseDelete(raw({ kind: KIND.Delete, pubkey: POSTER, tags: [["k", "1111"]], content: "oops" }));
    expect(d).toBeNull();
    // Defensive: even if a caller fabricated a Deletion with empty ids/coords, no candidate is hidden.
    const idea = raw({ kind: KIND.Comment, id: "id".repeat(32), pubkey: POSTER, tags: [["A", COORD]] });
    const empty: Deletion = { pubkey: POSTER, ids: [], coords: [], kinds: [1111], reason: "", createdAt: 1, raw: idea };
    expect(deletedEventIds([empty], [idea]).size).toBe(0);
  });

  it.todo("parseDelete must defend against tag-count blowups (dedupe or cap the e-tag id list)"); // M5
});

// ---------------------------------------------------------------------------
// Vote-tally interplay (the read path that consumes the hidden set)
// ---------------------------------------------------------------------------

describe("deletions: vote-tally interplay", () => {
  it("deleting a vote then re-voting: only the deleted id is dropped and the fresh vote counts", () => {
    const v1 = reaction("+", "tt", POSTER, { id: "c1".repeat(32), createdAt: 100, targetAuthor: AUTHOR });
    const v2 = reaction("-", "tt", POSTER, { id: "c2".repeat(32), createdAt: 300, targetAuthor: AUTHOR });
    const d = del({ ids: ["c1".repeat(32)] }, POSTER);
    const hidden = deletedEventIds([d], [v1, v2]);
    expect(hidden).toEqual(new Set(["c1".repeat(32)]));
    // Filter BEFORE tallying (the correct order): only the fresh downvote remains.
    const votes = [parseVote(v1)!, parseVote(v2)!].filter((v) => !hidden.has(v.id));
    const tally = tallyVotesByTarget(votes).get("tt");
    expect(tally).toMatchObject({ up: 0, down: 1, score: -1 });
    expect(tally?.byPubkey.get(POSTER)).toBe("down"); // the user's current vote is the fresh down
  });

  it("deleting your LATEST reaction resurfaces your PRIOR opposite reaction (append-only history)", () => {
    // Pinned, not a code defect: filtering out the latest (down) vote leaves the earlier (up) vote,
    // and latest-per-pubkey then reports "up". This is correct given append-only history + per-pubkey
    // dedup, but it means a single delete is "roll back to my previous vote", not "clear my vote".
    // Surfaced as a UX hazard in suspectedBugs (low severity, product-level, not a logic bug).
    const v1 = reaction("+", "idea1", POSTER, { id: "v1".repeat(32), createdAt: 100, targetAuthor: AUTHOR });
    const v2 = reaction("-", "idea1", POSTER, { id: "v2".repeat(32), createdAt: 200, targetAuthor: AUTHOR });
    const d = del({ ids: ["v2".repeat(32)] }, POSTER);
    const hidden = deletedEventIds([d], [v1, v2]);
    const votes = [parseVote(v1)!, parseVote(v2)!].filter((v) => !hidden.has(v.id));
    const tally = tallyVotesByTarget(votes).get("idea1");
    expect(tally).toMatchObject({ up: 1, down: 0, score: 1 });
    expect(tally?.byPubkey.get(POSTER)).toBe("up"); // the old upvote is highlighted again
  });
});

// ---------------------------------------------------------------------------
// Indexer parity: deriveBoardStats applies NIP-09 (combined flat list)
// ---------------------------------------------------------------------------

describe("deletions: deriveBoardStats indexer parity (combined idea + vote retraction)", () => {
  it("a single flat event list with both an idea-delete and a vote-delete drops the idea AND the vote", () => {
    // The shared aggregator must agree with the client read path: a retracted idea is absent and a
    // retracted upvote does not inflate the score. (deriveBoardStats DOES import parseDelete +
    // deletedEventIds and honors them; this pins the combined case in one flat list.)
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Keep" }), POSTER, "keep"),
      ev(buildIdea({ board: BOARD, title: "Gone" }), MOD, "gone"),
      ev(buildVote({ target: { id: "gone", pubkey: MOD }, direction: "up", createdAt: 110 }), POSTER, "vote1"),
      // POSTER retracts their upvote; MOD retracts their idea.
      ev(buildDelete({ ids: ["vote1"], kinds: [7], createdAt: 200 }), POSTER, "delVote"),
      ev(buildDelete({ ids: ["gone"], kinds: [1111], createdAt: 200 }), MOD, "delIdea"),
    ];
    const agg = deriveBoardStats(events);
    const ids = agg.ideas.map((i) => i.id);
    expect(ids).toContain("keep");
    expect(ids).not.toContain("gone"); // retracted idea absent from the aggregate
    // The "keep" idea has no votes; the only vote (on the now-gone idea) was retracted anyway.
    expect(agg.ideas.find((i) => i.id === "keep")?.score).toBe(0);
  });

  it("deriveBoardStats does NOT honor a cross-author forged delete (same-author rule end-to-end)", () => {
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Mine" }), POSTER, "mine"),
      // OUTSIDER forges a delete of POSTER's idea.
      ev(buildDelete({ ids: ["mine"], kinds: [1111], createdAt: 999 }), OUTSIDER, "forge"),
    ];
    const agg = deriveBoardStats(events);
    expect(agg.ideas.map((i) => i.id)).toContain("mine"); // forged delete ignored
  });
});