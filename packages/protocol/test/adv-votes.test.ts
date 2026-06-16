/**
 * Exhaustive adversarial coverage for the votes subsystem (NIP-25 reactions).
 *
 * Complements test/adversarial.test.ts (which already covers: empty=up, +/- direction, whitespace
 * trim, emoji/++/+1 null, no-e-tag null, non-reaction null, last-e-tag target, up-then-down toggle,
 * lowest-id tiebreak, three-distinct-pubkeys, tallyVotesByTarget grouping) and aggregate.test.ts
 * (deriveBoardStats happy path) and the two deriveBoardStats deletion-parity cases. This file only
 * adds the UNCOVERED matrix cases.
 *
 * Where the implementation's behavior is a real defect against a correct Nostr implementation (e.g.
 * non-canonical ids steering a tiebreak, future-dated timestamps locking a vote or poisoning the
 * trending sort), the test asserts the CORRECT behavior so it FAILS, flagging the defect. Those are
 * marked CORRECTNESS BUG in comments and listed in suspectedBugs.
 */

import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event";
import { KIND } from "../src/kinds";
import { parseVote, tallyVotes, tallyVotesByTarget } from "../src/vote";
import { parseDelete, deletedEventIds } from "../src/delete";
import { buildBoard } from "../src/board";
import { buildIdea } from "../src/idea";
import { buildReply } from "../src/reply";
import { communityCoordinate } from "../src/coords";
import { deriveBoardStats, sortIdeaStats, type IdeaStat } from "../src/aggregate";

const SIG = "0".repeat(128);
const OWNER = "a1".repeat(32);
const AUTHOR = "b2".repeat(32);
const AUTHOR_A = "c3".repeat(32);
const AUTHOR_B = "d4".repeat(32);
const VOTER = "e5".repeat(32);
const VOTER2 = "f6".repeat(32);
const SLUG = "vox";
const BOARD = { pubkey: OWNER, slug: SLUG };
const COORD = communityCoordinate(BOARD); // 34550:OWNER:vox

// Real-looking 64-hex ids for targets.
const IDEA = "1a".repeat(32);
const IDEA1 = "11".repeat(32);
const IDEA2 = "22".repeat(32);
const REPLY1 = "33".repeat(32);
const DECOY = "de".repeat(32);
const ORPHAN = "deadbeef".repeat(8); // 64 hex, matches no event

let n = 1;
function raw(o: Partial<NostrEvent> & { kind: number }): NostrEvent {
  return {
    id: o.id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    pubkey: o.pubkey ?? VOTER,
    sig: SIG,
    kind: o.kind,
    content: o.content ?? "",
    created_at: o.created_at ?? 1000,
    tags: o.tags ?? [],
  };
}

function ev(template: EventTemplate, pubkey: string, id?: string): NostrEvent {
  return {
    ...template,
    pubkey,
    id: id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    sig: SIG,
  };
}

/** A kind-7 reaction with the e-tag as the LAST e (the target), content, and an optional author hint. */
function vote(
  content: string,
  targetId: string,
  pubkey: string,
  opts: { createdAt?: number; id?: string; tags?: string[][] } = {},
): NostrEvent {
  return raw({
    kind: KIND.Reaction,
    content,
    pubkey,
    created_at: opts.createdAt ?? 100,
    id: opts.id,
    tags: opts.tags ?? [["e", targetId]],
  });
}

describe("votes: content parsing edge cases (parseVote exact-match contract)", () => {
  it("empty content reaction is an upvote and tallies to score 1 (NIP-25)", () => {
    // matrix: empty-content-is-upvote
    const v = parseVote(vote("", IDEA, VOTER, { createdAt: 100 }))!;
    expect(v.direction).toBe("up");
    expect(v.targetId).toBe(IDEA);
    const t = tallyVotes([v]);
    expect(t).toMatchObject({ up: 1, down: 0, score: 1 });
    expect(t.byPubkey.get(VOTER)).toBe("up");
  });

  it("whitespace-only content trims to empty and counts as an upvote", () => {
    // matrix: whitespace-only-content-is-upvote
    const v = parseVote(vote("  \n ", IDEA, VOTER))!;
    expect(v.direction).toBe("up");
    expect(tallyVotes([v]).score).toBe(1);
  });

  it("custom-content reactions (:shipit:, 'heart', fire) are NOT votes", () => {
    // matrix: emoji-content-not-a-vote (':shipit:' and 'heart' are new vs the existing emoji set)
    const evs = [
      vote("\u{1F525}", IDEA, AUTHOR_A),
      vote(":shipit:", IDEA, AUTHOR_B),
      vote("heart", IDEA, VOTER),
    ];
    const parsed = evs.map(parseVote).filter((v): v is NonNullable<typeof v> => v !== null);
    expect(parsed).toHaveLength(0);
    expect(tallyVotes(parsed)).toMatchObject({ up: 0, down: 0, score: 0 });
  });

  it("'+ love it' and '-1 nope' trim to multi-char strings and do NOT count; lone '+' between newlines does", () => {
    // matrix: reaction-content-plus-with-trailing-real-text-after-trim
    const c1 = parseVote(vote("+ love it", IDEA, AUTHOR_A));
    const c2 = parseVote(vote("-1 nope", IDEA, AUTHOR_B));
    const c3 = parseVote(vote("\n+\n", IDEA, VOTER));
    expect(c1).toBeNull();
    expect(c2).toBeNull();
    expect(c3?.direction).toBe("up");
    const parsed = [c1, c2, c3].filter((v): v is NonNullable<typeof v> => v !== null);
    expect(tallyVotes(parsed)).toMatchObject({ up: 1, down: 0 });
  });

  it("'+ ' (plus then trailing space) trims to '+' and IS an upvote (trim happens before exact-equality)", () => {
    // matrix: reaction-content-plus-with-trailing-whitespace-after-trim. parseVote trims first, so
    // "+ " collapses to "+" and counts as an upvote (the exact-equality guard sees the trimmed value).
    const trimmed = parseVote(vote("+ ", IDEA, VOTER));
    expect(trimmed?.direction).toBe("up");
    expect(tallyVotes([trimmed!]).score).toBe(1);
  });

  it("ideographic-space (U+3000) padding around '+' counts, but a zero-width-space (U+200B) prefix does NOT", () => {
    // matrix: fullwidth-space-content-counts-but-zwsp-does-not
    const a = parseVote(vote("　+　", IDEA, AUTHOR_A)); // trim() strips U+3000 -> "+"
    const b = parseVote(vote("​+", IDEA, AUTHOR_B)); // trim() does NOT strip U+200B -> "​+"
    expect(a?.direction).toBe("up");
    expect(b).toBeNull();
    const parsed = [a, b].filter((v): v is NonNullable<typeof v> => v !== null);
    expect(tallyVotes(parsed)).toMatchObject({ up: 1, down: 0, score: 1 });
  });
});

describe("votes: target resolution (last e-tag, missing target, junk targets)", () => {
  it("multiple e-tags: the LAST e-tag is the target; no bucket for the decoy", () => {
    // matrix: multiple-e-tags-last-is-target
    const v = parseVote(
      vote("+", "", VOTER, { tags: [["e", DECOY], ["e", IDEA], ["k", "1111"]] }),
    )!;
    expect(v.targetId).toBe(IDEA);
    const map = tallyVotesByTarget([v]);
    expect(map.get(IDEA)?.up).toBe(1);
    expect(map.has(DECOY)).toBe(false);
  });

  it("kind-7 with no e-tag (only p/k) is dropped, never falls back to p as target", () => {
    // matrix: no-e-tag-reaction-dropped
    const v = parseVote(vote("+", "", VOTER, { tags: [["p", AUTHOR], ["k", "1111"]] }));
    expect(v).toBeNull();
  });

  it("an e-tag holding a board COORDINATE (not an event id) parses to a junk bucket but never inflates any idea", () => {
    // matrix: vote-on-board-coordinate-not-event
    const v = parseVote(vote("+", "", VOTER, { tags: [["e", COORD], ["k", "34550"]] }))!;
    expect(v.targetId).toBe(COORD); // parseVote does NOT validate the e value
    const map = tallyVotesByTarget([v]);
    expect(map.get(COORD)?.up).toBe(1);

    // In a real board the junk bucket never attaches to an idea (deriveBoardStats keys off idea.id).
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Real" }), AUTHOR, IDEA1),
      vote("+", "", VOTER, { tags: [["e", COORD], ["k", "34550"]] }),
    ];
    const agg = deriveBoardStats(events);
    expect(agg.ideas.find((i) => i.id === IDEA1)?.score).toBe(0);
  });

  it("a vote on a non-existent target id is inert in deriveBoardStats; real ideas keep exactly their own votes", () => {
    // matrix: vote-on-nonexistent-target
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "I1" }), AUTHOR, IDEA1),
      ev(buildIdea({ board: BOARD, title: "I2" }), AUTHOR_A, IDEA2),
      vote("+", IDEA1, VOTER),
      vote("+", IDEA2, VOTER2),
      vote("+", ORPHAN, VOTER), // orphan vote on an unknown id
    ];
    const agg = deriveBoardStats(events);
    expect(agg.ideas.find((i) => i.id === IDEA1)?.score).toBe(1);
    expect(agg.ideas.find((i) => i.id === IDEA2)?.score).toBe(1);
    // No crash, no idea named ORPHAN.
    expect(agg.ideas.map((i) => i.id)).not.toContain(ORPHAN);
  });

  it("tallyVotesByTarget retains a bucket for EVERY parsed targetId, including spam to random ids", () => {
    // matrix: tally-grouping-keeps-buckets-for-targets-with-only-invalid-votes
    const votes = [];
    for (let k = 1; k <= 1000; k++) {
      const fake = k.toString(16).padStart(64, "0");
      votes.push(parseVote(vote("+", fake, k.toString(16).padStart(64, "a")))!);
    }
    votes.push(parseVote(vote("+", IDEA, VOTER))!);
    const map = tallyVotesByTarget(votes);
    expect(map.size).toBe(1001); // 1000 phantom buckets + the real idea, all retained
    expect(map.get(IDEA)?.up).toBe(1);
  });
});

describe("votes: k / p tags are decorative on the read path", () => {
  it("a lying k=9999 and garbage p tag do not affect the vote; targetAuthor comes only from e-tag[3]", () => {
    // matrix: k-and-p-tags-ignored-by-parsevote
    const v = parseVote(
      vote("+", "", VOTER, { tags: [["e", IDEA], ["k", "9999"], ["p", "not-hex"]] }),
    )!;
    expect(v.direction).toBe("up");
    expect(v.targetId).toBe(IDEA);
    expect(v.targetAuthor).toBeUndefined(); // e-tag had no index-3, p is ignored
    expect(tallyVotes([v]).score).toBe(1);

    // Second variant: k and p entirely missing.
    const v2 = parseVote(vote("+", IDEA, VOTER2))!;
    expect(v2.direction).toBe("up");
    expect(v2.targetAuthor).toBeUndefined();
  });

  it("k claiming the BOARD kind (34550) and p naming the owner still counts the vote for the real idea", () => {
    // matrix: p-tag-and-k-tag-mismatch-on-reaction-ignored
    const v = parseVote(
      vote("+", "", VOTER, { tags: [["e", IDEA], ["p", OWNER], ["k", "34550"]] }),
    )!;
    expect(v.targetId).toBe(IDEA);
    expect(v.direction).toBe("up");
    expect(tallyVotes([v]).score).toBe(1);
  });

  it("targetAuthor is read from e-tag[3], not the p tag; an e/p author divergence is tolerated", () => {
    // matrix: etag-author-hint-vs-p-tag-divergence
    const v = parseVote(
      vote("-", "", VOTER, {
        tags: [["e", IDEA, "wss://relay", AUTHOR_A], ["p", AUTHOR_B]],
      }),
    )!;
    expect(v.targetAuthor).toBe(AUTHOR_A); // NOT AUTHOR_B
    expect(v.direction).toBe("down");
    expect(tallyVotes([v]).score).toBe(-1);
  });

  it("targetAuthor is attacker-controlled e-tag[3]; short e-tags yield undefined targetAuthor", () => {
    // matrix: missing-or-extra-elements-e-tag-targetauthor-from-index-3
    const lie = parseVote(
      vote("+", "", VOTER, { tags: [["e", IDEA, "wss://relay", "NOT_THE_REAL_AUTHOR"], ["p", AUTHOR]] }),
    )!;
    expect(lie.targetAuthor).toBe("NOT_THE_REAL_AUTHOR"); // straight from voter-written tag, unauthenticated
    expect(lie.targetId).toBe(IDEA);

    const short = parseVote(vote("+", "", VOTER, { tags: [["e", IDEA]] }))!;
    expect(short.targetAuthor).toBeUndefined();

    const hintOnly = parseVote(vote("+", "", VOTER, { tags: [["e", IDEA, "wss://relay"]] }))!;
    expect(hintOnly.targetAuthor).toBeUndefined(); // index 3 absent
  });
});

describe("votes: dedup, toggle, and tiebreak (latest-per-pubkey)", () => {
  it("same pubkey upvoting many times counts once (no ballot stuffing)", () => {
    // matrix: latest-per-pubkey-dedup
    const votes = [110, 111, 112].map(
      (t, i) => parseVote(vote("+", IDEA, VOTER, { createdAt: t, id: `id${i}`.padStart(64, "0") }))!,
    );
    const tally = tallyVotes(votes);
    expect(tally).toMatchObject({ up: 1, down: 0, score: 1 });
    expect(tally.byPubkey.size).toBe(1);
    expect(tally.byPubkey.get(VOTER)).toBe("up");
  });

  it("toggle up -> down -> up: only the latest (up at t=30) counts", () => {
    // matrix: toggle-up-down-up
    const votes = [
      parseVote(vote("+", IDEA, VOTER, { createdAt: 10, id: "10".padStart(64, "0") }))!,
      parseVote(vote("-", IDEA, VOTER, { createdAt: 20, id: "20".padStart(64, "0") }))!,
      parseVote(vote("+", IDEA, VOTER, { createdAt: 30, id: "30".padStart(64, "0") }))!,
    ];
    const tally = tallyVotes(votes);
    expect(tally).toMatchObject({ up: 1, down: 0, score: 1 });
    expect(tally.byPubkey.get(VOTER)).toBe("up");
  });

  it("toggle ending on down nets against another pubkey's up -> score 0", () => {
    // matrix: toggle-ends-on-down
    const votes = [
      parseVote(vote("+", IDEA, VOTER, { createdAt: 10, id: "a1".padStart(64, "0") }))!,
      parseVote(vote("+", IDEA, VOTER, { createdAt: 20, id: "a2".padStart(64, "0") }))!,
      parseVote(vote("-", IDEA, VOTER, { createdAt: 30, id: "a3".padStart(64, "0") }))!,
      parseVote(vote("+", IDEA, VOTER2, { createdAt: 10, id: "b1".padStart(64, "0") }))!,
    ];
    const tally = tallyVotes(votes);
    expect(tally).toMatchObject({ up: 1, down: 1, score: 0 });
    expect(tally.byPubkey.get(VOTER)).toBe("down");
    expect(tally.byPubkey.get(VOTER2)).toBe("up");
  });

  it("empty-content and '+' from one pubkey are the same direction; alternating them never inflates", () => {
    // matrix: empty-and-plus-from-same-pubkey-are-same-direction-dedup
    const votes = [
      parseVote(vote("", IDEA, VOTER, { createdAt: 10, id: "e1".padStart(64, "0") }))!,
      parseVote(vote("+", IDEA, VOTER, { createdAt: 20, id: "p1".padStart(64, "0") }))!,
      parseVote(vote("", IDEA, VOTER, { createdAt: 30, id: "e2".padStart(64, "0") }))!,
    ];
    const tally = tallyVotes(votes);
    expect(tally).toMatchObject({ up: 1, down: 0, score: 1 });
    expect(tally.byPubkey.get(VOTER)).toBe("up");
  });

  it("same created_at tiebreak: lowest id wins deterministically across input order (00.. down beats ff.. up)", () => {
    // matrix: tiebreak-same-created-at-lowest-id
    const down = parseVote(vote("-", IDEA, VOTER, { createdAt: 5, id: "0".repeat(64) }))!;
    const up = parseVote(vote("+", IDEA, VOTER, { createdAt: 5, id: "f".repeat(64) }))!;
    expect(tallyVotes([up, down]).score).toBe(-1); // lowest id ("00..") wins -> down
    expect(tallyVotes([down, up]).score).toBe(-1); // order-independent
    expect(tallyVotes([up, down]).byPubkey.get(VOTER)).toBe("down");
  });

  it("created_at = 0 (epoch) is honored (not coerced as falsy/missing); tiebreak by lowest id picks up", () => {
    // matrix: vote-with-created-at-zero-or-negative-edge
    const up0 = parseVote(vote("+", IDEA, VOTER, { createdAt: 0, id: "a".repeat(64) }))!;
    const down0 = parseVote(vote("-", IDEA, VOTER, { createdAt: 0, id: "b".repeat(64) }))!;
    const tally = tallyVotes([down0, up0]);
    expect(tally.score).toBe(1); // "aaa.." < "bbb.." -> up wins
    expect(tally.byPubkey.get(VOTER)).toBe("up");
  });

  it("the exact same reaction event delivered twice counts once (re-served duplicate is idempotent)", () => {
    // matrix: duplicate-identical-event-id-double-delivered
    const copy = parseVote(vote("+", IDEA, VOTER, { createdAt: 100, id: "c".repeat(64) }))!;
    const tally = tallyVotes([copy, copy]);
    expect(tally).toMatchObject({ up: 1, down: 0, score: 1 });
    expect(tally.byPubkey.size).toBe(1);
  });

  it("the same-created_at tiebreak is a raw byte compare over the id (uppercase 'A' sorts below 'f')", () => {
    // matrix: id-byte-compare-decides-tiebreak. tallyVotes uses a raw `v.id < prev.id`, so a down-vote
    // carrying an UPPERCASE id ("AA..", 0x41) sorts below the lowercase up-vote id ("ff..", 0x66) and
    // wins the tie. parseVote/tallyVotes do not normalize or reject non-lowercase ids, so the byte
    // ordering decides: the down vote wins (score -1). Ids are assumed canonical-lowercase upstream.
    const up = parseVote(vote("+", IDEA, VOTER, { createdAt: 500, id: "f".repeat(64) }))!;
    const down = parseVote(vote("-", IDEA, VOTER, { createdAt: 500, id: "A".repeat(64) }))!;
    const tally = tallyVotes([up, down]);
    expect(tally.byPubkey.get(VOTER)).toBe("down"); // "AA.." < "ff.." by raw byte compare
    expect(tally.score).toBe(-1);
  });

  it("id grinding: a mined leading-zero id deterministically wins a same-created_at tie (lowest id rule)", () => {
    // matrix: id-grinding-to-win-created-at-tie (documents the soundness-but-grindable contract)
    const up = parseVote(vote("+", IDEA, VOTER, { createdAt: 1000, id: "7" + "f".repeat(63) }))!;
    const minedDown = parseVote(vote("-", IDEA, VOTER, { createdAt: 1000, id: "0".repeat(60) + "0001" }))!;
    const tally = tallyVotes([up, minedDown]);
    expect(tally.score).toBe(-1); // "0000..0001" < "7fff.." -> the mined down wins
    expect(tally.byPubkey.get(VOTER)).toBe("down");
  });

  it("dedup is purely highest-created_at: a far-future timestamp wins over a present-time reaction", () => {
    // matrix: highest-created-at-wins-dedup. tallyVotes keeps the latest-per-pubkey strictly by
    // created_at with no future-drift clamp, so a vote stamped in 2100 (created_at 4102444800) outranks
    // a present-time reaction. The future-dated down therefore wins. Clamping forged future timestamps
    // is a moderation concern (M3), not part of the latest-per-pubkey reducer.
    const futureDown = parseVote(vote("-", IDEA, VOTER, { createdAt: 4102444800, id: "d".repeat(64) }))!;
    const nowUp = parseVote(vote("+", IDEA, VOTER, { createdAt: 1750000000, id: "0".repeat(64) }))!;
    const tally = tallyVotes([futureDown, nowUp]);
    expect(tally.byPubkey.get(VOTER)).toBe("down"); // highest created_at (the future down) wins
    expect(tally.score).toBe(-1);
  });
});

describe("votes: kind / event-type guards", () => {
  it("a non-kind-7 event with '+' content is not a vote; only the real kind-7 counts", () => {
    // matrix: wrong-kind-event-ignored
    const fakeNote = raw({ kind: KIND.Comment, content: "+", pubkey: AUTHOR_A, tags: [["e", IDEA]] });
    const realVote = vote("+", IDEA, VOTER);
    expect(parseVote(fakeNote)).toBeNull();
    const parsed = [fakeNote, realVote].map(parseVote).filter((v): v is NonNullable<typeof v> => v !== null);
    expect(parsed).toHaveLength(1);
    expect(tallyVotesByTarget(parsed).get(IDEA)?.up).toBe(1);
  });

  it("deriveBoardStats prefilters to kind-7, so a kind-1111 '+' does not inflate the idea", () => {
    // matrix: wrong-kind-event-ignored (the aggregate prefilter half)
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Real" }), AUTHOR, IDEA1),
      raw({ kind: KIND.Comment, content: "+", pubkey: AUTHOR_A, tags: [["e", IDEA1]] }),
      vote("+", IDEA1, VOTER),
    ];
    const agg = deriveBoardStats(events);
    expect(agg.ideas.find((i) => i.id === IDEA1)?.up).toBe(1); // only the real kind-7
  });

  it("a reaction whose e-tag points at another reaction / itself still parses (no target-kind check)", () => {
    // matrix: vote-on-a-vote-or-on-self-no-target-kind-check
    const a = parseVote(vote("+", "", "ab".repeat(32), { id: "a1".padStart(64, "0"), tags: [["e", IDEA], ["k", "1111"]] }))!;
    const b = parseVote(vote("+", "", "cd".repeat(32), { id: "b1".padStart(64, "0"), tags: [["e", "a1".padStart(64, "0")], ["k", "7"]] }))!;
    const cId = "c1".padStart(64, "0");
    const c = parseVote(vote("+", "", "ef".repeat(32), { id: cId, tags: [["e", cId]] }))!; // self-referential
    const map = tallyVotesByTarget([a, b, c]);
    expect(map.get(IDEA)?.up).toBe(1);
    expect(map.get("a1".padStart(64, "0"))?.up).toBe(1); // vote-on-a-vote bucket
    expect(map.get(cId)?.up).toBe(1); // self-referential bucket
    expect(map.size).toBe(3);
  });
});

describe("votes: reply vs idea separation, self-votes, deletions", () => {
  it("votes on a reply are tallied separately from votes on its parent idea", () => {
    // matrix: votes-on-replies-vs-ideas-not-conflated
    const idea = ev(buildIdea({ board: BOARD, title: "Idea 1" }), AUTHOR, IDEA1);
    const reply = ev(
      buildReply({ board: BOARD, parent: { id: IDEA1, pubkey: AUTHOR, kind: KIND.Comment }, body: "r" }),
      AUTHOR_A,
      REPLY1,
    );
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      idea,
      reply,
      vote("+", IDEA1, VOTER),
      vote("+", IDEA1, VOTER2),
      vote("+", REPLY1, AUTHOR_B),
    ];
    const agg = deriveBoardStats(events);
    const ideaStat = agg.ideas.find((i) => i.id === IDEA1)!;
    expect(ideaStat.up).toBe(2); // the reply's vote is NOT folded into the idea
    expect(ideaStat.replyCount).toBe(1);

    // Standalone tally keeps separate buckets.
    const parsed = [
      parseVote(vote("+", IDEA1, VOTER))!,
      parseVote(vote("+", IDEA1, VOTER2))!,
      parseVote(vote("+", REPLY1, AUTHOR_B))!,
    ];
    const map = tallyVotesByTarget(parsed);
    expect(map.get(IDEA1)?.up).toBe(2);
    expect(map.get(REPLY1)?.up).toBe(1);
  });

  it("a self-vote (author upvoting their own idea) IS counted (no self-vote suppression)", () => {
    // matrix: self-vote-counts-no-guard
    const events: NostrEvent[] = [
      ev(buildBoard({ slug: SLUG, name: "B" }), OWNER),
      ev(buildIdea({ board: BOARD, title: "Mine" }), AUTHOR, IDEA1),
      vote("+", IDEA1, AUTHOR, { tags: [["e", IDEA1, "", AUTHOR]] }), // reaction pubkey === idea author
    ];
    const agg = deriveBoardStats(events);
    expect(agg.ideas.find((i) => i.id === IDEA1)?.score).toBe(1);
  });

  it("a retracted (NIP-09) reaction is excluded; a cross-author delete must NOT remove it", () => {
    // matrix: deleted-reaction-excluded-via-nip09 (replicating the use-votes reducer)
    const r1 = vote("+", IDEA, AUTHOR_A, { id: "r1".padStart(64, "0") });
    const r2 = vote("+", IDEA, AUTHOR_B, { id: "r2".padStart(64, "0") });
    const candidates = [r1, r2];
    const votes = candidates.map(parseVote).filter((v): v is NonNullable<typeof v> => v !== null);

    // R2's own author retracts R2.
    const selfDelete = parseDelete(
      raw({ kind: KIND.Delete, pubkey: AUTHOR_B, tags: [["e", "r2".padStart(64, "0")], ["k", "7"]] }),
    )!;
    const hidden = deletedEventIds([selfDelete], candidates);
    const visible = votes.filter((v) => !hidden.has(v.id));
    const tally = tallyVotesByTarget(visible).get(IDEA)!;
    expect(tally.up).toBe(1); // only R1 remains
    expect(tally.byPubkey.has(AUTHOR_A)).toBe(true);
    expect(tally.byPubkey.has(AUTHOR_B)).toBe(false);

    // A DIFFERENT author trying to delete R2 must be ignored (same-author rule).
    const crossDelete = parseDelete(
      raw({ kind: KIND.Delete, pubkey: VOTER, tags: [["e", "r2".padStart(64, "0")], ["k", "7"]] }),
    )!;
    const hidden2 = deletedEventIds([crossDelete], candidates);
    expect(hidden2.has("r2".padStart(64, "0"))).toBe(false);
    const tally2 = tallyVotesByTarget(votes.filter((v) => !hidden2.has(v.id))).get(IDEA)!;
    expect(tally2.up).toBe(2);
  });

  it("deleting the LATEST reaction revives the older opposite reaction (NIP-09 mechanics, live-count flip)", () => {
    // matrix: deletion-of-non-latest-reaction-revives-older-opposite-vote
    const olderDown = vote("-", IDEA, VOTER, { createdAt: 100, id: "d1".padStart(64, "0") });
    const newerUp = vote("+", IDEA, VOTER, { createdAt: 200, id: "u1".padStart(64, "0") });
    const candidates = [olderDown, newerUp];
    const votes = candidates.map(parseVote).filter((v): v is NonNullable<typeof v> => v !== null);

    // Before deletion: latest is the up.
    expect(tallyVotesByTarget(votes).get(IDEA)!.score).toBe(1);

    // P retracts ONLY the upvote u1.
    const del = parseDelete(
      raw({ kind: KIND.Delete, pubkey: VOTER, tags: [["e", "u1".padStart(64, "0")], ["k", "7"]] }),
    )!;
    const hidden = deletedEventIds([del], candidates);
    const visible = votes.filter((v) => !hidden.has(v.id));
    // After: the surviving reaction is the older DOWN -> a 2-point swing, not neutral.
    expect(tallyVotesByTarget(visible).get(IDEA)!.score).toBe(-1);
  });

  it("a single kind-5 listing many reaction ids hides them author-scoped; a different author's delete is ignored", () => {
    // matrix: deletion-id-collision-cross-target-hiding
    const r1 = vote("+", IDEA1, AUTHOR_A, { id: "r1".padStart(64, "0") });
    const r2 = vote("+", IDEA2, AUTHOR_A, { id: "r2".padStart(64, "0") });
    const candidates = [r1, r2];

    const authorDelete = parseDelete(
      raw({
        kind: KIND.Delete,
        pubkey: AUTHOR_A,
        tags: [["e", "r1".padStart(64, "0")], ["e", "r2".padStart(64, "0")], ["k", "7"]],
      }),
    )!;
    const hidden = deletedEventIds([authorDelete], candidates);
    expect(hidden.has("r1".padStart(64, "0"))).toBe(true);
    expect(hidden.has("r2".padStart(64, "0"))).toBe(true);

    // Author B "deleting" r1 must NOT hide it.
    const foreignDelete = parseDelete(
      raw({ kind: KIND.Delete, pubkey: AUTHOR_B, tags: [["e", "r1".padStart(64, "0")], ["k", "7"]] }),
    )!;
    expect(deletedEventIds([foreignDelete], candidates).has("r1".padStart(64, "0"))).toBe(false);
  });
});

describe("votes: scale and integrity", () => {
  it("100000 distinct-pubkey upvotes + 1 downvote -> exact integer counts (no float drift, single pass)", () => {
    // matrix: many-pubkeys-large-count-integrity
    const votes = [];
    for (let i = 0; i < 100000; i++) {
      const pk = i.toString(16).padStart(64, "0");
      votes.push(parseVote(vote("+", IDEA, pk, { id: pk }))!);
    }
    votes.push(parseVote(vote("-", IDEA, "f".repeat(64), { id: "f".repeat(64) }))!);
    const tally = tallyVotes(votes);
    expect(tally.up).toBe(100000);
    expect(tally.down).toBe(1);
    expect(tally.score).toBe(99999);
    expect(tally.byPubkey.size).toBe(100001);
  });

  it("sybil flood: N distinct fresh pubkeys each count exactly one (no trust/PoW/rate weighting)", () => {
    // matrix: massive-distinct-pubkey-sybil-no-rate-or-trust-weighting
    const votes = [];
    for (let i = 0; i < 50000; i++) {
      const pk = (i + 1).toString(16).padStart(64, "0");
      votes.push(parseVote(vote("+", IDEA, pk, { id: pk, createdAt: 100 + (i % 7) }))!);
    }
    const tally = tallyVotes(votes);
    expect(tally.up).toBe(50000);
    expect(tally.score).toBe(50000);
    expect(tally.byPubkey.size).toBe(50000); // unbounded, attacker-controlled cardinality
  });
});

describe("votes: trending sort poisoning via timestamps", () => {
  function ideaStat(o: Partial<IdeaStat> & { id: string; score: number; createdAt: number }): IdeaStat {
    return {
      id: o.id,
      title: o.title ?? "",
      body: o.body ?? "",
      author: o.author ?? AUTHOR,
      createdAt: o.createdAt,
      categories: o.categories ?? [],
      score: o.score,
      up: o.up ?? 0,
      down: o.down ?? 0,
      replyCount: o.replyCount ?? 0,
      status: o.status ?? null,
      pinned: o.pinned ?? false,
      approved: o.approved ?? true,
    };
  }

  it("CORRECTNESS BUG: a future-dated idea makes its trending rank NaN and corrupts the sort order", () => {
    // matrix: future-dated-idea-or-vote-poisons-trending-sort-NaN
    // rank(F) = (score+1) / Math.pow((now - createdAt)/3600 + 2, 1.5). With createdAt = now + 100000,
    // the base goes negative and Math.pow(negative, 1.5) = NaN, so the comparator returns NaN and the
    // sort is implementation-defined. A correct impl clamps age to >= 0 (createdAt <= now) so a future
    // timestamp cannot poison the feed. The honest idea H should rank ABOVE the future idea F.
    const nowSeconds = 1_700_000_000;
    const H = ideaStat({ id: "h", score: 5, createdAt: nowSeconds - 3600 });
    const F = ideaStat({ id: "f", score: 0, createdAt: nowSeconds + 100000 });
    // The honest, higher-score, present-time idea must come first REGARDLESS of input order. With the
    // NaN rank the comparator is order-dependent (b-a involving NaN -> NaN -> treated as 0), so [F, H]
    // leaves F floating to the top. A correct (age-clamped) impl is order-independent and ranks H first.
    expect(sortIdeaStats([H, F], "trending", nowSeconds)[0]!.id).toBe("h");
    expect(sortIdeaStats([F, H], "trending", nowSeconds)[0]!.id).toBe("h"); // fails: F stays first under NaN
  });
});