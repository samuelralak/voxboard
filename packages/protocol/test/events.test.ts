import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event.js";
import { validateNostrEvent } from "../src/event.js";
import { buildBoard, parseBoard } from "../src/board.js";
import { buildIdea, parseIdea, isIdeaEvent } from "../src/idea.js";
import { buildReply, parseReply, isReplyEvent } from "../src/reply.js";
import { buildVote, parseVote, tallyVotes, tallyVotesByTarget } from "../src/vote.js";
import { buildStatus, parseStatus } from "../src/status.js";
import {
  buildPin,
  parsePin,
  buildLock,
  parseLock,
  buildHide,
  parseHide,
  buildBan,
  parseBan,
  collapseStatuses,
  pinnedTargets,
  hiddenTargets,
  bannedSubjects,
  lockCutoffs,
  resolveModerators,
  isAuthorized,
} from "../src/moderation.js";
import { buildApproval, parseApproval } from "../src/approval.js";
import { parseProfile } from "../src/profile.js";
import { buildDelete, parseDelete, deletedEventIds } from "../src/delete.js";

// 64-char hex test identities
const OWNER = "a1".repeat(32);
const MOD = "b2".repeat(32);
const POSTER = "c3".repeat(32);
const OUTSIDER = "d4".repeat(32);
const SLUG = "acme-feedback";
const BOARD = { pubkey: OWNER, slug: SLUG };

const SIG = "0".repeat(128);
let idCounter = 0;
/** Turn a builder template into a signed-shaped event (parsers do not check the sig). */
function asEvent(template: EventTemplate, pubkey: string, id?: string): NostrEvent {
  const eventId = id ?? (idCounter++).toString(16).padStart(64, "0");
  return { ...template, pubkey, id: eventId, sig: SIG };
}

describe("board (34550)", () => {
  it("round-trips name, description, moderators, relays, categories, mode", () => {
    const event = asEvent(
      buildBoard({
        slug: SLUG,
        name: "Acme feedback",
        description: "Tell us what to build.",
        moderators: [{ pubkey: MOD }],
        relays: [{ url: "wss://relay.example", marker: "requests" }],
        categories: ["bug", "feature"],
        mode: "open",
      }),
      OWNER,
    );
    const board = parseBoard(event);
    expect(board).not.toBeNull();
    expect(board!.pubkey).toBe(OWNER);
    expect(board!.slug).toBe(SLUG);
    expect(board!.coordinate).toBe(`34550:${OWNER}:${SLUG}`);
    expect(board!.name).toBe("Acme feedback");
    expect(board!.description).toBe("Tell us what to build.");
    expect(board!.moderators).toEqual([{ pubkey: MOD }]);
    expect(board!.relays).toEqual([{ url: "wss://relay.example", marker: "requests" }]);
    expect(board!.categories).toEqual(["bug", "feature"]);
    expect(board!.mode).toBe("open");
  });

  it("requires d and name", () => {
    expect(parseBoard(asEvent({ kind: 34550, created_at: 1, tags: [], content: "" }, OWNER))).toBeNull();
  });

  it("only treats p-tags with the canonical \"moderator\" marker as moderators", () => {
    const event = asEvent(
      {
        kind: 34550,
        created_at: 1,
        tags: [
          ["d", SLUG],
          ["name", "Acme"],
          ["p", MOD, "", "moderator"], // honored
          ["p", OUTSIDER], // no marker -> NOT a moderator
          ["p", POSTER, "", "admin"], // non-spec marker -> NOT a moderator
        ],
        content: "",
      },
      OWNER,
    );
    expect(parseBoard(event)!.moderators).toEqual([{ pubkey: MOD }]);
  });
});

function makeBoard() {
  return parseBoard(
    asEvent(buildBoard({ slug: SLUG, name: "Acme", moderators: [{ pubkey: MOD }] }), OWNER),
  )!;
}

describe("idea (1111 top-level)", () => {
  it("round-trips title, body, categories, images and is recognised as an idea not a reply", () => {
    const tmpl = buildIdea({
      board: BOARD,
      title: "Export roadmap as CSV",
      body: "We need CSV export.",
      categories: ["feature"],
      images: [{ url: "https://media.example/a.png", mime: "image/png", alt: "shot" }],
    });
    const event = asEvent(tmpl, POSTER);
    expect(isIdeaEvent(event)).toBe(true);
    expect(isReplyEvent(event)).toBe(false);

    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    expect(idea!.title).toBe("Export roadmap as CSV");
    expect(idea!.body).toBe("We need CSV export.");
    expect(idea!.board).toEqual(BOARD);
    expect(idea!.coordinate).toBe(`34550:${OWNER}:${SLUG}`);
    expect(idea!.categories).toEqual(["feature"]);
    expect(idea!.images).toEqual([
      { url: "https://media.example/a.png", mime: "image/png", alt: "shot" },
    ]);
  });

  it("emits no empty subject tag and falls back to the first line of content", () => {
    const event = asEvent(buildIdea({ board: BOARD, title: "", body: "First line\nsecond" }), POSTER);
    expect(event.tags.some((t) => t[0] === "subject")).toBe(false);
    expect(parseIdea(event)!.title).toBe("First line");
  });
});

describe("reply (1111 nested)", () => {
  it("round-trips parent and is recognised as a reply not an idea", () => {
    const ideaEvent = asEvent(buildIdea({ board: BOARD, title: "T" }), POSTER, "f0".repeat(32));
    const replyEvent = asEvent(
      buildReply({
        board: BOARD,
        parent: { id: ideaEvent.id, pubkey: POSTER, kind: 1111 },
        body: "plus one",
      }),
      MOD,
    );
    expect(isReplyEvent(replyEvent)).toBe(true);
    expect(parseIdea(replyEvent)).toBeNull();

    const reply = parseReply(replyEvent);
    expect(reply).not.toBeNull();
    expect(reply!.parentId).toBe(ideaEvent.id);
    expect(reply!.parentKind).toBe(1111);
    expect(reply!.parentAuthor).toBe(POSTER);
    expect(reply!.body).toBe("plus one");
  });
});

describe("vote (7)", () => {
  it("encodes + / - and rejects emoji", () => {
    const up = asEvent(buildVote({ target: { id: "f1".repeat(32), pubkey: POSTER }, direction: "up" }), MOD);
    const down = asEvent(
      buildVote({ target: { id: "f1".repeat(32), pubkey: POSTER }, direction: "down" }),
      OUTSIDER,
    );
    expect(parseVote(up)!.direction).toBe("up");
    expect(parseVote(down)!.direction).toBe("down");
    const emoji = asEvent({ kind: 7, created_at: 1, tags: [["e", "f1".repeat(32)]], content: "🔥" }, MOD);
    expect(parseVote(emoji)).toBeNull();
  });

  it("tallies latest-per-pubkey (a flip replaces the earlier vote)", () => {
    const target = "f2".repeat(32);
    const votes = [
      parseVote(asEvent({ ...buildVote({ target: { id: target, pubkey: POSTER }, direction: "up", createdAt: 100 }) }, POSTER))!,
      parseVote(asEvent({ ...buildVote({ target: { id: target, pubkey: POSTER }, direction: "up", createdAt: 100 }) }, MOD))!,
      parseVote(asEvent({ ...buildVote({ target: { id: target, pubkey: POSTER }, direction: "down", createdAt: 200 }) }, POSTER))!,
    ];
    const tally = tallyVotes(votes);
    expect(tally.up).toBe(1); // MOD
    expect(tally.down).toBe(1); // POSTER flipped to down
    expect(tally.score).toBe(0);
    expect(tally.byPubkey.get(POSTER)).toBe("down");

    const byTarget = tallyVotesByTarget(votes);
    expect(byTarget.get(target)!.score).toBe(0);
  });
});

describe("status (1985 label)", () => {
  it("round-trips state, note, duplicateOf", () => {
    const event = asEvent(
      buildStatus({
        target: { id: "f3".repeat(32) },
        board: BOARD,
        state: "in-progress",
        note: "Shipping Q3",
        duplicateOf: { id: "f4".repeat(32) },
      }),
      OWNER,
    );
    const status = parseStatus(event);
    expect(status).not.toBeNull();
    expect(status!.state).toBe("in-progress");
    expect(status!.note).toBe("Shipping Q3");
    expect(status!.targetId).toBe("f3".repeat(32));
    expect(status!.duplicateOf).toBe("f4".repeat(32));
  });

  it("rejects an invalid status value", () => {
    const event = asEvent(
      { kind: 1985, created_at: 1, tags: [["L", "app.nostr-userinput.status"], ["l", "bogus", "app.nostr-userinput.status"], ["e", "f3".repeat(32)]], content: "" },
      OWNER,
    );
    expect(parseStatus(event)).toBeNull();
  });
});

describe("moderation trust + collapse", () => {
  const board = makeBoard();

  it("resolves owner + moderators as authorized", () => {
    expect(resolveModerators(board)).toEqual(new Set([OWNER, MOD]));
    expect(isAuthorized(OWNER, board)).toBe(true);
    expect(isAuthorized(MOD, board)).toBe(true);
    expect(isAuthorized(OUTSIDER, board)).toBe(false);
  });

  it("collapses to the latest AUTHORIZED status, ignoring outsiders even if newer", () => {
    const target = "f5".repeat(32);
    const labels = [
      parseStatus(asEvent(buildStatus({ target: { id: target }, board: BOARD, state: "planned", createdAt: 100 }), OWNER))!,
      parseStatus(asEvent(buildStatus({ target: { id: target }, board: BOARD, state: "in-progress", createdAt: 200 }), MOD))!,
      parseStatus(asEvent(buildStatus({ target: { id: target }, board: BOARD, state: "closed", createdAt: 300 }), OUTSIDER))!,
    ];
    const current = collapseStatuses(labels, board);
    expect(current.get(target)!.state).toBe("in-progress"); // MOD's, newest authorized; OUTSIDER ignored
  });

  it("pin / hide / ban honor only authorized authors; lock exposes a cutoff", () => {
    const idea = "f6".repeat(32);
    const pins = [
      parsePin(asEvent(buildPin({ target: { id: idea }, board: BOARD }), MOD))!,
      parsePin(asEvent(buildPin({ target: { id: "f7".repeat(32) }, board: BOARD }), OUTSIDER))!,
    ];
    expect(pinnedTargets(pins, board)).toEqual(new Set([idea]));

    const hides = [parseHide(asEvent(buildHide({ target: { id: idea }, board: BOARD }), OWNER))!];
    expect(hiddenTargets(hides, board)).toEqual(new Set([idea]));

    const bans = [
      parseBan(asEvent(buildBan({ subject: OUTSIDER, board: BOARD }), OWNER))!,
      parseBan(asEvent(buildBan({ subject: MOD, board: BOARD }), OUTSIDER))!, // outsider can't ban
    ];
    expect(bannedSubjects(bans, board)).toEqual(new Set([OUTSIDER]));

    const lock = parseLock(asEvent(buildLock({ target: { id: idea }, board: BOARD, createdAt: 555 }), OWNER))!;
    expect(lockCutoffs([lock], board).get(idea)).toBe(555);
  });
});

describe("approval (4550)", () => {
  it("embeds and recovers the approved post", () => {
    const post = asEvent(buildIdea({ board: BOARD, title: "Idea" }), POSTER, "ab".repeat(32));
    const approval = parseApproval(asEvent(buildApproval({ board: BOARD, post }), MOD));
    expect(approval).not.toBeNull();
    expect(approval!.postId).toBe(post.id);
    expect(approval!.postAuthor).toBe(POSTER);
    expect(approval!.post?.id).toBe(post.id);
  });
});

describe("profile (0)", () => {
  it("parses metadata and prefers picture over deprecated image", () => {
    const event = asEvent(
      {
        kind: 0,
        created_at: 1,
        tags: [],
        content: JSON.stringify({ name: "alice", image: "old.png", picture: "new.png", nip05: "alice@example.com", lud16: "alice@wallet" }),
      },
      POSTER,
    );
    const profile = parseProfile(event)!;
    expect(profile.name).toBe("alice");
    expect(profile.picture).toBe("new.png");
    expect(profile.nip05).toBe("alice@example.com");
    expect(profile.lud16).toBe("alice@wallet");
  });

  it("returns null on invalid JSON", () => {
    expect(parseProfile(asEvent({ kind: 0, created_at: 1, tags: [], content: "{not json" }, POSTER))).toBeNull();
  });
});

describe("delete (5)", () => {
  it("only deletes events by the same author (NIP-09 rule)", () => {
    const mine = asEvent(buildIdea({ board: BOARD, title: "mine" }), POSTER, "11".repeat(32));
    const theirs = asEvent(buildIdea({ board: BOARD, title: "theirs" }), MOD, "22".repeat(32));
    // POSTER tries to delete both ids
    const del = parseDelete(asEvent(buildDelete({ ids: [mine.id, theirs.id], kinds: [1111] }), POSTER))!;
    const hidden = deletedEventIds([del], [mine, theirs]);
    expect(hidden.has(mine.id)).toBe(true); // own event: deleted
    expect(hidden.has(theirs.id)).toBe(false); // someone else's: NOT deleted
  });

  it("surfaces k kind hints and applies a-coordinate deletions by created_at", () => {
    const coord = `34550:${OWNER}:${SLUG}`;
    const del = parseDelete(
      asEvent(buildDelete({ coords: [coord], kinds: [34550], createdAt: 200 }), OWNER),
    )!;
    expect(del.kinds).toEqual([34550]);
    expect(del.coords).toEqual([coord]);

    // an OWNER board at the coord created before the delete is hidden; a newer one survives
    const older = asEvent({ ...buildBoard({ slug: SLUG, name: "old" }), created_at: 100 }, OWNER, "a0".repeat(32));
    const newer = asEvent({ ...buildBoard({ slug: SLUG, name: "new" }), created_at: 300 }, OWNER, "b0".repeat(32));
    const hidden = deletedEventIds([del], [older, newer]);
    expect(hidden.has(older.id)).toBe(true);
    expect(hidden.has(newer.id)).toBe(false);
  });
});

describe("validateNostrEvent", () => {
  it("accepts a well-formed envelope and rejects malformed", () => {
    const good = asEvent(buildIdea({ board: BOARD, title: "x" }), POSTER, "cd".repeat(32));
    expect(validateNostrEvent(good)).not.toBeNull();
    expect(validateNostrEvent({ ...good, id: "short" })).toBeNull();
    expect(validateNostrEvent({ kind: 1 })).toBeNull();
  });
});
