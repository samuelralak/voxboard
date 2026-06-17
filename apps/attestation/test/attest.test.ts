import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { buildBoard, communityCoordinate, KIND, type NostrEvent } from "@voxboard/protocol";
import { attestBoard, fetchBoard } from "../src/attest.js";
import { fakeRelays } from "./fake-relays.js";

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const stranger = getPublicKey(generateSecretKey());

function boardEvent(input: { slug: string; name: string; createdAt?: number } = { slug: "demo", name: "Demo board" }): NostrEvent {
  return finalizeEvent(buildBoard(input), ownerSk) as NostrEvent;
}
const coordOf = (slug: string) => communityCoordinate({ pubkey: owner, slug });

describe("attestBoard (the gate)", () => {
  it("attests a conforming board for its owner, pinning the current event id", async () => {
    const board = boardEvent();
    const { client } = fakeRelays([board]);
    const decision = await attestBoard({ coordinate: coordOf("demo"), requester: owner }, { client });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.coordinate).toBe(coordOf("demo"));
      expect(decision.eventId).toBe(board.id);
      expect(decision.board.name).toBe("Demo board");
    }
  });

  it("rejects a requester who is neither the owner nor an operator", async () => {
    const { client } = fakeRelays([boardEvent()]);
    const decision = await attestBoard({ coordinate: coordOf("demo"), requester: stranger }, { client });
    expect(decision.ok).toBe(false);
  });

  it("admits a configured operator for any board", async () => {
    const { client } = fakeRelays([boardEvent()]);
    const decision = await attestBoard(
      { coordinate: coordOf("demo"), requester: stranger },
      { client, isOperator: (pk) => pk === stranger },
    );
    expect(decision.ok).toBe(true);
  });

  it("rejects a non-board (wrong-kind) coordinate", async () => {
    const { client } = fakeRelays([]);
    const decision = await attestBoard({ coordinate: `1111:${owner}:x`, requester: owner }, { client });
    expect(decision.ok).toBe(false);
  });

  it("rejects when the board is absent from relays", async () => {
    const { client } = fakeRelays([]);
    const decision = await attestBoard({ coordinate: coordOf("ghost"), requester: owner }, { client });
    expect(decision.ok).toBe(false);
  });

  it("rejects a non-conforming board (kind 34550 with a d tag but no name => parseBoard null)", async () => {
    const malformed = finalizeEvent(
      { kind: KIND.Community, created_at: 1000, tags: [["d", "broken"]], content: "" },
      ownerSk,
    ) as NostrEvent;
    const { client } = fakeRelays([malformed]);
    const decision = await attestBoard({ coordinate: coordOf("broken"), requester: owner }, { client });
    expect(decision.ok).toBe(false);
  });

  it("attests a board whose request coordinate carries UPPERCASE pubkey hex (canonical compare)", async () => {
    const { client } = fakeRelays([boardEvent()]);
    const upper = `34550:${owner.toUpperCase()}:demo`;
    const decision = await attestBoard({ coordinate: upper, requester: owner }, { client });
    expect(decision.ok).toBe(true);
  });

  it("rejects a malformed (non-hex) requester (fail closed)", async () => {
    const { client } = fakeRelays([boardEvent()]);
    for (const bad of ["", "nope", "Z".repeat(64)]) {
      const decision = await attestBoard({ coordinate: coordOf("demo"), requester: bad }, { client });
      expect(decision.ok).toBe(false);
    }
  });

  it("fetchBoard picks the latest board version (addressable replaceable)", async () => {
    const v1 = finalizeEvent(buildBoard({ slug: "demo", name: "Old", createdAt: 1000 }), ownerSk) as NostrEvent;
    const v2 = finalizeEvent(buildBoard({ slug: "demo", name: "New", createdAt: 2000 }), ownerSk) as NostrEvent;
    const { client } = fakeRelays([v1, v2]);
    const board = await fetchBoard(client, coordOf("demo"));
    expect(board?.name).toBe("New");
    expect(board?.raw.id).toBe(v2.id);
  });
});
