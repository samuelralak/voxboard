import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event.js";
import { buildIdea } from "../src/idea.js";
import { buildReply } from "../src/reply.js";
import { partitionBoardEvents, buildThread, countThread } from "../src/thread.js";

const OWNER = "a1".repeat(32);
const POSTER = "c3".repeat(32);
const BOARD = { pubkey: OWNER, slug: "acme" };
const SIG = "0".repeat(128);

function ev(template: EventTemplate, id: string, pubkey = POSTER, createdAt?: number): NostrEvent {
  return { ...template, ...(createdAt ? { created_at: createdAt } : {}), pubkey, id, sig: SIG };
}

const IDEA = "1d".repeat(32);
function reply(id: string, parentId: string, parentPubkey: string, createdAt: number): NostrEvent {
  return ev(
    buildReply({ board: BOARD, parent: { id: parentId, pubkey: parentPubkey, kind: 1111 }, body: id }),
    id,
    POSTER,
    createdAt,
  );
}

describe("partitionBoardEvents", () => {
  it("splits ideas from replies", () => {
    const ideaEvent = ev(buildIdea({ board: BOARD, title: "Idea" }), IDEA);
    const replyEvent = reply("re".repeat(32), IDEA, POSTER, 10);
    const { ideas, replies } = partitionBoardEvents([ideaEvent, replyEvent]);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.id).toBe(IDEA);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.parentId).toBe(IDEA);
  });
});

describe("buildThread", () => {
  const RA = "aa".repeat(32);
  const RA1 = "a1a1".repeat(16);
  const RB = "bb".repeat(32);
  const ORPHAN = "ee".repeat(32);

  it("nests replies, orders oldest-first, drops orphans", () => {
    const replies = partitionBoardEvents([
      reply(RB, IDEA, POSTER, 200),
      reply(RA, IDEA, POSTER, 100),
      reply(RA1, RA, POSTER, 150),
      reply(ORPHAN, "ff".repeat(32), POSTER, 120), // parent not present -> dropped
    ]).replies;

    const tree = buildThread(IDEA, replies);
    expect(tree.map((n) => n.reply.id)).toEqual([RA, RB]); // oldest-first
    expect(tree[0]!.children.map((n) => n.reply.id)).toEqual([RA1]);
    expect(tree[0]!.depth).toBe(0);
    expect(tree[0]!.children[0]!.depth).toBe(1);
    expect(countThread(tree)).toBe(3); // RA, RA1, RB (orphan excluded)
  });

  it("is cycle-safe", () => {
    const RX = "1111".repeat(16);
    const RY = "2222".repeat(16);
    const replies = partitionBoardEvents([reply(RX, RY, POSTER, 10), reply(RY, RX, POSTER, 20)]).replies;
    // neither reaches the root; must terminate and return nothing
    expect(buildThread(IDEA, replies)).toEqual([]);
  });
});
