import { describe, it, expect } from "vitest";
import {
  communityCoordinate,
  parseCommunityCoordinate,
  parseCoordinate,
  boardNaddr,
  ideaNevent,
  decodeEntity,
} from "../src/coords.js";
import { KIND } from "../src/kinds.js";

// A valid 64-char hex pubkey (NIP-19 spec example) and an arbitrary 64-hex event id.
const OWNER = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT_ID = "5c83da77af1dec6d7289834998ad7aafbd9e2191396d75ec3cc27f5a77226f36";
const SLUG = "acme-feedback";

describe("community coordinate", () => {
  it("builds and parses round-trip", () => {
    const coord = communityCoordinate({ pubkey: OWNER, slug: SLUG });
    expect(coord).toBe(`${KIND.Community}:${OWNER}:${SLUG}`);
    expect(parseCommunityCoordinate(coord)).toEqual({ pubkey: OWNER, slug: SLUG });
  });

  it("preserves a slug that contains colons", () => {
    const coord = communityCoordinate({ pubkey: OWNER, slug: "a:b:c" });
    expect(parseCommunityCoordinate(coord)).toEqual({ pubkey: OWNER, slug: "a:b:c" });
  });

  it("rejects malformed coordinates", () => {
    expect(parseCoordinate("not-a-coord")).toBeNull();
    expect(parseCoordinate("34550:tooshort:slug")).toBeNull();
    expect(parseCommunityCoordinate(`1:${OWNER}:slug`)).toBeNull();
  });
});

describe("naddr (board)", () => {
  it("encodes and decodes a board, preserving owner + slug", () => {
    const naddr = boardNaddr({ pubkey: OWNER, slug: SLUG }, ["wss://relay.example"]);
    const decoded = decodeEntity(naddr);
    expect(decoded?.type).toBe("board");
    if (decoded?.type === "board") {
      expect(decoded.ref).toEqual({ pubkey: OWNER, slug: SLUG });
      expect(decoded.relays).toContain("wss://relay.example");
    }
  });
});

describe("nevent (idea)", () => {
  it("encodes and decodes an idea id", () => {
    const nevent = ideaNevent({ id: EVENT_ID, author: OWNER, relays: ["wss://relay.example"] });
    const decoded = decodeEntity(nevent);
    expect(decoded?.type).toBe("idea");
    if (decoded?.type === "idea") {
      expect(decoded.ref.id).toBe(EVENT_ID);
      expect(decoded.ref.author).toBe(OWNER);
    }
  });
});

describe("decodeEntity", () => {
  it("returns null for garbage", () => {
    expect(decodeEntity("definitely-not-bech32")).toBeNull();
  });
});
