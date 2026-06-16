import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event";
import { buildBoard } from "../src/board";
import { buildIdea } from "../src/idea";
import { buildVote } from "../src/vote";
import { buildStatus } from "../src/status";
import { buildHide, buildPin } from "../src/moderation";
import { deriveBoardStats, sortIdeaStats, visibleIdeas, type IdeaStat } from "../src/aggregate";

const SIG = "0".repeat(128);
const OWNER = "a1".repeat(32);
const MOD = "b2".repeat(32);
const A1 = "c3".repeat(32);
const A2 = "d4".repeat(32);
const A3 = "e5".repeat(32);
const V1 = "f1".repeat(32);
const V2 = "f2".repeat(32);
const V3 = "f3".repeat(32);
const SLUG = "voxboard";
const BOARD = { pubkey: OWNER, slug: SLUG };

const IDEA1 = "1d".repeat(32);
const IDEA2 = "2d".repeat(32);
const IDEA3 = "3d".repeat(32);

let counter = 0;
function ev(template: EventTemplate, pubkey: string, id?: string): NostrEvent {
  return { ...template, pubkey, id: id ?? (counter++).toString(16).padStart(64, "0"), sig: SIG };
}

function buildBoardEvents(): NostrEvent[] {
  return [
    ev(buildBoard({ slug: SLUG, name: "Voxboard", moderators: [{ pubkey: MOD }] }), OWNER),
    ev(buildIdea({ board: BOARD, title: "Idea 1", categories: ["feature"], createdAt: 100 }), A1, IDEA1),
    ev(buildIdea({ board: BOARD, title: "Idea 2", categories: ["bug"], createdAt: 200 }), A2, IDEA2),
    ev(buildIdea({ board: BOARD, title: "Spam", createdAt: 300 }), A3, IDEA3),
    // idea1: three upvotes -> score 3
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 110 }), V1),
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 111 }), V2),
    ev(buildVote({ target: { id: IDEA1, pubkey: A1 }, direction: "up", createdAt: 112 }), V3),
    // idea2: one up, one down -> score 0
    ev(buildVote({ target: { id: IDEA2, pubkey: A2 }, direction: "up", createdAt: 210 }), V1),
    ev(buildVote({ target: { id: IDEA2, pubkey: A2 }, direction: "down", createdAt: 211 }), V2),
    // owner sets idea1 status; mod hides the spam idea; owner pins idea2
    ev(buildStatus({ target: { id: IDEA1 }, board: BOARD, state: "planned", createdAt: 120 }), OWNER),
    ev(buildHide({ target: { id: IDEA3 }, board: BOARD, createdAt: 320 }), MOD),
    ev(buildPin({ target: { id: IDEA2 }, board: BOARD, createdAt: 220 }), OWNER),
    // an UNAUTHORIZED hide of idea1 by a random user -> must be ignored
    ev(buildHide({ target: { id: IDEA1 }, board: BOARD, createdAt: 130 }), A2),
  ];
}

describe("deriveBoardStats", () => {
  const agg = deriveBoardStats(buildBoardEvents());

  it("derives the board and all three ideas", () => {
    expect(agg.board?.name).toBe("Voxboard");
    expect(agg.ideas.map((i) => i.id).sort()).toEqual([IDEA1, IDEA2, IDEA3].sort());
  });

  it("tallies votes, applies owner status, and honors a mod pin", () => {
    const idea1 = agg.ideas.find((i) => i.id === IDEA1)!;
    expect(idea1.up).toBe(3);
    expect(idea1.down).toBe(0);
    expect(idea1.score).toBe(3);
    expect(idea1.status).toBe("planned");

    const idea2 = agg.ideas.find((i) => i.id === IDEA2)!;
    expect(idea2.score).toBe(0); // 1 up, 1 down
    expect(idea2.pinned).toBe(true);
  });

  it("honors a moderator hide but ignores an unauthorized hide", () => {
    expect(agg.hidden.has(IDEA3)).toBe(true); // mod hid the spam
    expect(agg.hidden.has(IDEA1)).toBe(false); // random user's hide ignored
  });

  it("visibleIdeas excludes hidden and lists pinned first", () => {
    const visible = visibleIdeas(agg, { sort: "top" });
    expect(visible.map((i) => i.id)).not.toContain(IDEA3); // hidden
    expect(visible[0]!.id).toBe(IDEA2); // pinned first
    expect(visible).toHaveLength(2);
  });

  it("filters by tag", () => {
    expect(visibleIdeas(agg, { tag: "feature" }).map((i) => i.id)).toEqual([IDEA1]);
  });
});

describe("sortIdeaStats", () => {
  const base: Omit<IdeaStat, "id" | "score" | "createdAt"> = {
    title: "",
    body: "",
    author: A1,
    categories: [],
    up: 0,
    down: 0,
    replyCount: 0,
    status: null,
    pinned: false,
    approved: true,
  };
  const rows: IdeaStat[] = [
    { ...base, id: "a", score: 3, createdAt: 100 },
    { ...base, id: "b", score: 1, createdAt: 300 },
    { ...base, id: "c", score: 5, createdAt: 200 },
  ];

  it("top sorts by score desc", () => {
    expect(sortIdeaStats(rows, "top", 1000).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("new sorts by createdAt desc", () => {
    expect(sortIdeaStats(rows, "new", 1000).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("pinned always sorts first", () => {
    const withPin = [...rows, { ...base, id: "p", score: 0, createdAt: 0, pinned: true }];
    expect(sortIdeaStats(withPin, "top", 1000)[0]!.id).toBe("p");
  });
});
