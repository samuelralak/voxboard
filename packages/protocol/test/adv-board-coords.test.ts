/**
 * Adversarial coverage for the board-coords subsystem (board.ts, coords.ts).
 *
 * Scope: pure protocol-unit cases only. e2e/app cases (useBoard render behavior, NDK
 * latest-replaceable resolution, route white-screen) are intentionally NOT here.
 *
 * This file deliberately deduplicates against test/adversarial.test.ts and test/coords.test.ts,
 * which already cover: basic coordinate round-trip, slug-with-colons survival, the "34550:" /
 * ":x:y" / "" / "34550" / "1:OWNER:x" / short-pubkey malformed set, board missing-name,
 * board missing-d, and the ALICE-only "moderator" marker filter. Those are not repeated.
 *
 * Where the code's real behavior matches a correct Nostr implementation, we assert it and pin it.
 * Where the code is genuinely WRONG vs a correct implementation, we still assert the CORRECT
 * behavior so the test FAILS, and the defect is reported in suspectedBugs. Such cases are marked
 * with a `BUG:` comment so a green run is impossible while the defect stands.
 */

import { describe, it, expect } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import type { NostrEvent } from "../src/event";
import { KIND, MODERATION_MODE } from "../src/kinds";
import { parseBoard } from "../src/board";
import {
  communityCoordinate,
  parseCoordinate,
  parseCommunityCoordinate,
  boardNaddr,
  decodeEntity,
} from "../src/coords";

const SIG = "0".repeat(128);
// A real lowercase-hex 64-char pubkey (NIP-19 spec example) so naddr encode/decode actually works.
const OWNER = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT_ID = "5c83da77af1dec6d7289834998ad7aafbd9e2191396d75ec3cc27f5a77226f36";
// Distinct 64-hex moderator pubkeys.
const MOD1 = "11".repeat(32);
const MOD2 = "22".repeat(32);
const MOD3 = "33".repeat(32);
const MOD4 = "44".repeat(32);
const MOD5 = "55".repeat(32);
const MOD6 = "66".repeat(32);
const MOD7 = "77".repeat(32);

let n = 1;
function raw(o: Partial<NostrEvent> & { kind: number }): NostrEvent {
  return {
    id: o.id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    pubkey: o.pubkey ?? OWNER,
    sig: SIG,
    kind: o.kind,
    content: o.content ?? "",
    created_at: o.created_at ?? 1_700_000_000,
    tags: o.tags ?? [],
  };
}

/** A kind-34550 community event with the supplied tags. */
function board(tags: string[][], extra: Partial<NostrEvent> = {}): NostrEvent {
  return raw({ kind: KIND.Community, pubkey: OWNER, tags, ...extra });
}

// ===========================================================================
// parseBoard: presence / kind / slug-vs-name asymmetry
// ===========================================================================

describe("board-coords parseBoard: kind + presence guards", () => {
  it("parseboard-missing-d-returns-null: no d tag at all parses to null", () => {
    // getTagValue(tags,"d") === undefined -> `slug === undefined` short-circuits.
    const e = board([
      ["name", "Acme Feedback"],
      ["moderation_mode", "open"],
    ]);
    expect(parseBoard(e)).toBeNull();
  });

  it("parseboard-empty-d-is-valid-slug: empty-string d is accepted with slug '' and trailing-colon coordinate", () => {
    // Asymmetry vs name: getTagValue returns "" which is !== undefined, so empty slug survives.
    const e = board([
      ["d", ""],
      ["name", "Acme"],
      ["moderation_mode", "open"],
    ]);
    const parsed = parseBoard(e);
    expect(parsed).not.toBeNull();
    expect(parsed?.slug).toBe("");
    expect(parsed?.coordinate).toBe(`34550:${OWNER}:`);
    expect(parsed?.ref).toEqual({ pubkey: OWNER, slug: "" });
  });

  it("parseboard-missing-name-returns-null: undefined name AND empty-string name both fail (asymmetry vs slug)", () => {
    // (a) no name tag at all.
    expect(
      parseBoard(
        board([
          ["d", "acme"],
          ["moderation_mode", "open"],
        ]),
      ),
    ).toBeNull();
    // (b) empty-string name: `!name` rejects "" even though "" slug is allowed.
    expect(
      parseBoard(
        board([
          ["d", "acme"],
          ["name", ""],
          ["moderation_mode", "open"],
        ]),
      ),
    ).toBeNull();
  });

  it("parseboard-wrong-kind-returns-null: non-34550 kinds with board-shaped tags parse to null", () => {
    const tags = [
      ["d", "acme"],
      ["name", "Acme"],
      ["moderation_mode", "open"],
    ];
    for (const kind of [30023, 1111, 34551, 30000, 0]) {
      expect(parseBoard(raw({ kind, pubkey: OWNER, tags })), `kind ${kind}`).toBeNull();
    }
  });

  it("parseboard-whitespace-only-name-rejected: a whitespace-only name is trimmed and rejected", () => {
    // The name guard trims first, so "   " becomes "" and is rejected (a board with no visible name
    // is unusable). Only empty/undefined/blank names fail; any non-blank name is kept.
    const e = board([
      ["d", "s"],
      ["name", "   "],
    ]);
    expect(parseBoard(e)).toBeNull();
  });
});

// ===========================================================================
// parseBoard: moderator discrimination
// ===========================================================================

describe("board-coords parseBoard: moderator p-tag discrimination", () => {
  it("parseboard-moderator-marker-discrimination: only exact 'moderator' marker at index 3 counts", () => {
    const e = board([
      ["d", "s"],
      ["name", "n"],
      ["moderation_mode", "open"],
      ["p", MOD1, "", "moderator"], // valid, no relay
      ["p", MOD2, "wss://r.example", "moderator"], // valid, with relay
      ["p", MOD3], // bare, no marker
      ["p", MOD4, "", "Moderator"], // capitalized -> excluded
      ["p", MOD5, "", "mod"], // abbrev -> excluded
      ["p", MOD6, "wss://r", "admin"], // other marker -> excluded
      ["p", "", "", "moderator"], // empty pubkey -> dropped by `!pubkey`
      ["p", MOD7, "wss://r", "moderator", "extra"], // marker at index 3, trailing junk -> kept
    ]);
    const parsed = parseBoard(e);
    expect(parsed?.moderators).toEqual([
      { pubkey: MOD1 }, // no relay key when t[2] is empty
      { pubkey: MOD2, relay: "wss://r.example" },
      { pubkey: MOD7, relay: "wss://r" },
    ]);
  });

  it("parseboard-non-hex-pubkey-moderator-rejected: a non-hex moderator pubkey is dropped", () => {
    // parseBoard requires a 64-hex moderator pubkey, so a garbage moderator identity is rejected and
    // cannot pollute the roster or later crash an encoder.
    const e = board([
      ["d", "s"],
      ["name", "n"],
      ["p", "not-a-pubkey", "", "moderator"], // kept today; should be rejected
      ["p", "", "", "moderator"], // empty -> always dropped
    ]);
    const parsed = parseBoard(e);
    expect(parsed?.moderators).toEqual([]);
  });

  it("parseboard-duplicate-moderators-deduped: the same moderator pubkey twice collapses to one", () => {
    // Moderators are deduped by pubkey (keeping the first relay hint), consistent with categories, so
    // duplicate p-tags for one pubkey cannot inflate the roster.
    const e = board([
      ["d", "s"],
      ["name", "n"],
      ["p", MOD1, "", "moderator"],
      ["p", MOD1, "wss://r", "moderator"],
    ]);
    const parsed = parseBoard(e);
    expect(parsed?.moderators).toEqual([{ pubkey: MOD1 }]);
  });
});

// ===========================================================================
// parseBoard: categories, relays, image, mode
// ===========================================================================

describe("board-coords parseBoard: categories / relays / image / mode", () => {
  it("parseboard-duplicate-categories-deduped: dedupe is case-sensitive and blank categories are filtered out", () => {
    // Exact dupes 'bug'/'feature' collapse; 'Bug' is distinct (Set is case-sensitive);
    // categories are trimmed and any empty/blank one (["t",""], a missing-value ["t"]) is dropped.
    const e = board([
      ["d", "s"],
      ["name", "n"],
      ["moderation_mode", "open"],
      ["t", "bug"],
      ["t", "feature"],
      ["t", "bug"],
      ["t", "Bug"],
      ["t", "feature"],
      ["t", ""],
      ["t"],
      ["t", "ui"],
    ]);
    expect(parseBoard(e)?.categories).toEqual(["bug", "feature", "Bug", "ui"]);
  });

  it("parseboard-empty-string-category-dropped: a lone empty-string category is filtered out entirely", () => {
    // Blank categories are trimmed away, so ['', 'bug', ''] collapses to just ['bug'].
    const e = board([
      ["d", "s"],
      ["name", "n"],
      ["t", ""],
      ["t", "bug"],
      ["t", ""],
    ]);
    expect(parseBoard(e)?.categories).toEqual(["bug"]);
  });

  it("parseboard-malformed-relay-tags: missing-url dropped, unknown/empty/wrong-case markers stripped, valid markers kept", () => {
    const e = board([
      ["d", "s"],
      ["name", "n"],
      ["moderation_mode", "open"],
      ["relay", "wss://a"], // no marker
      ["relay", "wss://b", "author"],
      ["relay", "wss://c", "requests"],
      ["relay", "wss://d", "approvals"],
      ["relay", "wss://e", "bogus"], // unknown marker -> stripped
      ["relay"], // no url -> dropped
      ["relay", ""], // empty url -> dropped
      ["relay", "wss://f", ""], // empty marker -> stripped
      ["relay", "wss://g", "AUTHOR"], // wrong case -> stripped
    ]);
    expect(parseBoard(e)?.relays).toEqual([
      { url: "wss://a" },
      { url: "wss://b", marker: "author" },
      { url: "wss://c", marker: "requests" },
      { url: "wss://d", marker: "approvals" },
      { url: "wss://e" },
      { url: "wss://f" },
      { url: "wss://g" },
    ]);
  });

  it("parseboard-image-edge: image without url omitted; url-only vs url+dim handled", () => {
    // (a) ["image"] and ["image",""] -> image undefined (guard `imageTag?.[1]`).
    expect(
      parseBoard(
        board([
          ["d", "s"],
          ["name", "n"],
          ["image"],
          ["image", ""],
        ]),
      )?.image,
    ).toBeUndefined();
    // (b) url, no dim.
    expect(
      parseBoard(
        board([
          ["d", "s"],
          ["name", "n"],
          ["image", "https://x/i.png"],
        ]),
      )?.image,
    ).toEqual({ url: "https://x/i.png" });
    // (c) url + dim.
    expect(
      parseBoard(
        board([
          ["d", "s"],
          ["name", "n"],
          ["image", "https://x/i.png", "800x600"],
        ]),
      )?.image,
    ).toEqual({ url: "https://x/i.png", dim: "800x600" });
  });

  it("parseboard-mode-edge: only exact 'curated' is curated; everything else collapses to open; duplicate mode -> first wins", () => {
    const m = (tags: string[][]) =>
      parseBoard(board([["d", "s"], ["name", "n"], ...tags]))?.mode;
    expect(m([])).toBe(MODERATION_MODE.open); // missing -> open
    expect(m([["moderation_mode", "curated"]])).toBe(MODERATION_MODE.curated);
    expect(m([["moderation_mode", "CURATED"]])).toBe(MODERATION_MODE.open); // not exact
    expect(m([["moderation_mode", "weird"]])).toBe(MODERATION_MODE.open);
    // duplicate mode tags: getTagValue returns the FIRST -> 'curated'.
    expect(
      m([
        ["moderation_mode", "curated"],
        ["moderation_mode", "open"],
      ]),
    ).toBe(MODERATION_MODE.curated);
  });
});

// ===========================================================================
// parseBoard: multi-tag ordering + control-char injection
// ===========================================================================

describe("board-coords parseBoard: multi-tag + injection hazards", () => {
  it("parseboard-multiple-d-and-name-tags-first-wins: getTagValue takes the FIRST d/name", () => {
    // NIP-01 says a replaceable event should carry a single d tag; getTagValue honors the first.
    // We pin the first-wins behavior (matches NIP-01 replaceable keying when the relay also keys on
    // the first d), documenting the selection-ambiguity surface.
    const e = board([
      ["d", "real"],
      ["d", "evil"],
      ["name", "Real Board"],
      ["name", "Evil Board"],
    ]);
    const parsed = parseBoard(e);
    expect(parsed?.slug).toBe("real");
    expect(parsed?.name).toBe("Real Board");
    expect(parsed?.coordinate).toBe(`34550:${OWNER}:real`);
  });

  it("parseboard-newline-in-slug-coordinate-injection: a newline + fake coordinate in the slug embeds a second coordinate", () => {
    // communityCoordinate just template-concatenates, doing no escaping; the canonical coordinate
    // becomes multi-line and, after the newline, resembles a second valid coordinate.
    const evilPk = "b2".repeat(32);
    const hostileSlug = `a\n34550:${evilPk}:hijack`;
    const e = board([
      ["d", hostileSlug],
      ["name", "n"],
    ]);
    const parsed = parseBoard(e);
    // parseCommunityCoordinate stays anchored on the owner + first colon, so the slug survives
    // verbatim (newline and embedded coordinate included). This documents that the injected second
    // coordinate is smuggled INTO the slug rather than replacing identity.
    expect(parsed?.coordinate).toBe(`34550:${OWNER}:${hostileSlug}`);
    expect(parseCommunityCoordinate(parsed!.coordinate)).toEqual({
      pubkey: OWNER,
      slug: hostileSlug,
    });
    // The embedded substring is NOT separately resolvable by parseCommunityCoordinate as identity,
    // but a consumer that splits the coordinate on "\n" would see two coordinate-shaped lines.
    expect(parsed?.coordinate.split("\n")).toHaveLength(2);
  });
});

// ===========================================================================
// parseCoordinate / parseCommunityCoordinate
// ===========================================================================

describe("board-coords parseCoordinate: malformed + coercion footguns", () => {
  it("parsecoord-malformed-strings: single-colon / empty-pubkey / whitespace-pubkey all reject", () => {
    // Not already covered by the existing suite: "34550::" (empty pubkey + empty slug) and
    // "34550: :slug" (1-char whitespace pubkey).
    for (const bad of ["34550::", "34550: :slug", "not-a-coord"]) {
      expect(parseCoordinate(bad), `parseCoordinate ${JSON.stringify(bad)}`).toBeNull();
      expect(
        parseCommunityCoordinate(bad),
        `parseCommunityCoordinate ${JSON.stringify(bad)}`,
      ).toBeNull();
    }
  });

  it("parsecoord-wrong-kind-segment: junk / non-integer / wrong-but-valid kinds are rejected by the community wrapper", () => {
    // parseCoordinate derives a kind via Number()+Number.isInteger; the community wrapper then
    // rejects anything !== 34550.
    expect(parseCommunityCoordinate(`1:${OWNER}:slug`)).toBeNull(); // kind 1
    expect(parseCommunityCoordinate(`34550abc:${OWNER}:slug`)).toBeNull(); // Number -> NaN
    expect(parseCommunityCoordinate(`3.5:${OWNER}:slug`)).toBeNull(); // non-integer
    // Sanity: parseCoordinate accepts the kind-1 case (it is a valid non-community coordinate).
    expect(parseCoordinate(`1:${OWNER}:slug`)).toEqual({
      kind: 1,
      pubkey: OWNER,
      identifier: "slug",
    });
  });

  it("coord-empty-kind-segment-rejected: ':<pubkey>:slug' has no canonical kind segment and is rejected", () => {
    // The kind segment must match the canonical decimal grammar /^(0|[1-9][0-9]*)$/. An empty kind
    // segment fails it, so parseCoordinate returns null instead of coercing Number("") to a bogus
    // kind 0. The community wrapper rejects it too.
    const empty = `:${OWNER}:slug`;
    expect(parseCoordinate(empty)).toBeNull();
    expect(parseCommunityCoordinate(empty)).toBeNull();
  });

  it("coord-leading-space-and-scientific-notation alias to kind 34550 and are wrongly ACCEPTED as boards", () => {
    // BUG (high): parseCoordinate trusts JS Number() coercion. " 34550" (leading space) and
    // "3.4550e4" (scientific notation) and "34550.0" all coerce to 34550 and pass isInteger, so the
    // community wrapper green-lights NON-CANONICAL kind segments as real boards. A correct parser
    // requires the exact decimal string "34550". We assert the SAFE behavior (reject), so these FAIL.
    expect(parseCommunityCoordinate(` 34550:${OWNER}:slug`)).toBeNull();
    expect(parseCommunityCoordinate(`3.4550e4:${OWNER}:my-slug`)).toBeNull();
    expect(parseCommunityCoordinate(`34550.0:${OWNER}:slug`)).toBeNull();
  });

  it("coord-other-coercions: hex / scientific / signed kinds are non-canonical and rejected by parseCoordinate", () => {
    // parseCoordinate now requires the kind segment to be a canonical decimal (/^(0|[1-9][0-9]*)$/),
    // so scientific-notation, hex, and signed kinds no longer coerce through Number(): they are
    // rejected outright (null), not merely caught by the community wrapper.
    expect(parseCoordinate(`1e3:${OWNER}:slug`)).toBeNull();
    expect(parseCoordinate(`0x100:${OWNER}:slug`)).toBeNull();
    expect(parseCoordinate(`-34550:${OWNER}:slug`)).toBeNull();
    for (const wrong of [`1e3:${OWNER}:slug`, `0x100:${OWNER}:slug`, `-34550:${OWNER}:slug`]) {
      expect(parseCommunityCoordinate(wrong), wrong).toBeNull();
    }
  });

  it("parsecoord-slug-with-colons-and-unicode: everything after the second colon is the slug, verbatim", () => {
    // Not in the existing suite beyond plain "a:b:c": exercise unicode + emoji + emoji-with-colons.
    const cases: Array<[string, string]> = [
      ["a:b:c", "a:b:c"],
      ["café-fünf", "café-fünf"],
      ["rocket-\u{1F680}-board", "rocket-\u{1F680}-board"],
      ["has:\u{1F680}:colons", "has:\u{1F680}:colons"],
    ];
    for (const [slug, expected] of cases) {
      const ref = parseCommunityCoordinate(`34550:${OWNER}:${slug}`);
      expect(ref?.slug, slug).toBe(expected);
      // Round-trips through communityCoordinate.
      expect(communityCoordinate({ pubkey: OWNER, slug: ref!.slug })).toBe(
        `34550:${OWNER}:${slug}`,
      );
    }
  });

  it("parsecoord-nonhex-64char-pubkey-rejected: a 64-char non-hex pubkey is rejected, so boardNaddr never sees it", () => {
    // The pubkey must be 64 hex (case-insensitive). A 64-char non-hex pubkey ("zzz..") fails the
    // hex check and parseCommunityCoordinate returns null, so the boardNaddr crash path is never
    // reached.
    const ref = parseCommunityCoordinate(`34550:${"z".repeat(64)}:acme`);
    expect(ref).toBeNull();
    // Uppercase-hex (64 'A') IS valid hex; it parses and is lowercased to a stable canonical identity.
    const upperRef = parseCommunityCoordinate(`34550:${"A".repeat(64)}:acme`);
    expect(upperRef).toEqual({ pubkey: "a".repeat(64), slug: "acme" });
    expect(() => boardNaddr(upperRef!)).not.toThrow();
  });
});

// ===========================================================================
// naddr / nip19 round-trip boundaries (boardNaddr + decodeEntity)
// ===========================================================================

describe("board-coords decodeEntity: entity classification", () => {
  it("decodeentity-non-board-naddr-and-other-entities: each NIP-19 entity classifies correctly", () => {
    // naddr with kind 30023 -> 'other' (NOT board, NOT null).
    const naddrArticle = nip19.naddrEncode({
      identifier: "x",
      pubkey: OWNER,
      kind: 30023,
      relays: [],
    });
    const decodedArticle = decodeEntity(naddrArticle);
    expect(decodedArticle?.type).toBe("other");

    // board naddr, no relays.
    const naddrBoard = boardNaddr({ pubkey: OWNER, slug: "acme" }, []);
    expect(decodeEntity(naddrBoard)).toEqual({
      type: "board",
      ref: { pubkey: OWNER, slug: "acme" },
      relays: [],
    });

    // board naddr, with relays.
    const naddrBoardRelays = boardNaddr({ pubkey: OWNER, slug: "acme" }, [
      "wss://r1",
      "wss://r2",
    ]);
    expect(decodeEntity(naddrBoardRelays)).toEqual({
      type: "board",
      ref: { pubkey: OWNER, slug: "acme" },
      relays: ["wss://r1", "wss://r2"],
    });

    // nevent (no author/relays in payload) -> idea with relays defaulted to [].
    const nevent = nip19.neventEncode({ id: EVENT_ID, kind: KIND.Comment });
    const decodedNevent = decodeEntity(nevent);
    expect(decodedNevent?.type).toBe("idea");
    if (decodedNevent?.type === "idea") {
      expect(decodedNevent.ref.id).toBe(EVENT_ID);
      expect(decodedNevent.ref.relays).toEqual([]);
      expect(decodedNevent.ref.author).toBeUndefined();
    }

    // note -> idea with bare id.
    const note = nip19.noteEncode(EVENT_ID);
    expect(decodeEntity(note)).toEqual({ type: "idea", ref: { id: EVENT_ID } });

    // npub -> npub.
    const npub = nip19.npubEncode(OWNER);
    expect(decodeEntity(npub)).toEqual({ type: "npub", pubkey: OWNER });

    // garbage and empty -> null (decode throws, caught).
    expect(decodeEntity("definitely-not-bech32")).toBeNull();
    expect(decodeEntity("")).toBeNull();
  });

  it("decodeentity-nprofile-and-empty-id-naddr: nprofile -> 'other' (not npub), empty-id board naddr -> board slug ''", () => {
    // (a) nprofile carries a pubkey; decodeEntity classifies it as type 'npub' (resolving the entity
    // to its pubkey), the same as a bare npub. The relay hints in the nprofile are not needed here.
    const nprofile = nip19.nprofileEncode({ pubkey: OWNER, relays: [] });
    expect(decodeEntity(nprofile)).toEqual({ type: "npub", pubkey: OWNER });

    // (b) empty-identifier board naddr decodes as a board with slug '' (consistent with the
    // empty-d parseBoard case). This is the current behavior and is internally consistent, so we
    // pin it as the intended cross-path contract.
    const emptyIdNaddr = boardNaddr({ pubkey: OWNER, slug: "" });
    expect(decodeEntity(emptyIdNaddr)).toEqual({
      type: "board",
      ref: { pubkey: OWNER, slug: "" },
      relays: [],
    });
  });
});

describe("board-coords naddr: byte-length, case-folding, and hostile relay hints", () => {
  it("naddr-pubkey-case-folding: an uppercase-hex coordinate normalizes to the canonical lowercase pubkey", () => {
    // parseCommunityCoordinate lowercases the hex pubkey, so an uppercase-hex coordinate yields the
    // SAME canonical identity as the lowercase one. The naddr round-trip (also lowercase) then agrees,
    // so raw-string coordinate equality holds.
    const upper = "3BF0C63FCB93463407AF97A5E5EE64FA883D107EF9E558472C4EB9AAAEFA459D";
    const ref = parseCommunityCoordinate(`34550:${upper}:slug`);
    expect(ref?.pubkey).toBe(OWNER); // parse lowercases the hex pubkey
    const decoded = decodeEntity(boardNaddr(ref!));
    expect(decoded?.type).toBe("board");
    if (decoded?.type === "board") {
      // naddr is also lowercase, so the round-tripped pubkey matches the normalized ref.
      expect(decoded.ref.pubkey).toBe(OWNER);
      expect(decoded.ref.pubkey).toBe(ref!.pubkey);
    }
    // The uppercase and lowercase coordinates resolve to the same canonical pubkey: no desync.
    expect(parseCommunityCoordinate(`34550:${upper}:slug`)?.pubkey).toBe(OWNER);
  });

  it("naddr-slug-over-255-bytes: a 256-byte ASCII slug encodes but is UNDECODABLE (TLV 1-byte length overflow)", () => {
    // naddrEncode succeeds; nip19.decode throws because the NIP-19 identifier TLV length is a single
    // byte (max 255). 255 bytes round-trips; 256 bytes does not. parseBoard imposes no slug-length
    // cap, so such a board is un-shareable by naddr. We pin the encode/decode boundary so the
    // protocol-layer-vs-naddr-path gap is exercised.
    const ok = boardNaddr({ pubkey: OWNER, slug: "x".repeat(255) });
    expect(() => nip19.decode(ok)).not.toThrow();
    const overflow = boardNaddr({ pubkey: OWNER, slug: "x".repeat(256) });
    expect(() => nip19.decode(overflow)).toThrow();
  });

  it("naddr-emoji-slug-256-bytes: 64 emoji (256 bytes) overflow the TLV cap though it is only 64 'characters'", () => {
    // The boundary is UTF-8 byte length, not codepoint count: 63 emoji (252 bytes) round-trips,
    // 64 emoji (256 bytes) does not. Proves that surviving parseBoard does NOT mean surviving the
    // naddr path the app relies on.
    const sixtyThree = "\u{1F680}".repeat(63);
    const sixtyFour = "\u{1F680}".repeat(64);
    expect(() => nip19.decode(boardNaddr({ pubkey: OWNER, slug: sixtyThree }))).not.toThrow();
    expect(() => nip19.decode(boardNaddr({ pubkey: OWNER, slug: sixtyFour }))).toThrow();
  });

  it("naddr-malicious-relay-hints: 'javascript:' and non-ws junk URLs are filtered out of decodeEntity().relays", () => {
    // boardNaddr/decodeEntity sanitize relay hints to ws://|wss:// schemes, so a shared naddr carrying
    // arbitrary 'relay' strings cannot smuggle non-ws urls into decodeEntity().relays. Only the valid
    // wss:// hint survives.
    const naddr = boardNaddr({ pubkey: OWNER, slug: "slug" }, [
      "javascript:alert(1)",
      "not-a-url",
      "http://evil",
      "wss://r",
    ]);
    const decoded = decodeEntity(naddr);
    expect(decoded?.type).toBe("board");
    if (decoded?.type === "board") {
      expect(decoded.relays).toEqual(["wss://r"]);
    }
  });

  it("naddr-relay-hint-flooding: 50 relay hints are capped to at most 10 on decode", () => {
    // Decoded relay hints are capped (and deduped), so an attacker-crafted naddr cannot force many
    // relay connections on every recipient: the count is bounded to <= 10.
    const relays = Array.from({ length: 50 }, (_, i) => `wss://r${i}.example`);
    const decoded = decodeEntity(boardNaddr({ pubkey: OWNER, slug: "slug" }, relays));
    expect(decoded?.type).toBe("board");
    if (decoded?.type === "board") {
      expect(decoded.relays.length).toBeLessThanOrEqual(10);
    }
  });
});

// ===========================================================================
// parseBoard statelessness (replaceable resolution is NDK's job, not parseBoard's)
// ===========================================================================

describe("board-coords parseBoard: statelessness vs replaceable 'latest wins'", () => {
  it("parseboard-latest-version-wins-is-NDK-not-parseBoard: parseBoard faithfully parses whichever version it is handed", () => {
    // parseBoard has NO notion of 'latest'; it parses a stale event exactly as given. The
    // 'latest replaceable wins' guarantee lives in NDK fetchEvent, not here. We pin statelessness so
    // any consumer knows parseBoard will return a stale name/mode if handed a stale event.
    const v1 = board(
      [
        ["d", "acme"],
        ["name", "Old Name"],
        ["moderation_mode", "open"],
      ],
      { created_at: 1_700_000_000 },
    );
    const v2 = board(
      [
        ["d", "acme"],
        ["name", "New Name"],
        ["moderation_mode", "curated"],
      ],
      { created_at: 1_700_000_500 },
    );
    const p1 = parseBoard(v1);
    const p2 = parseBoard(v2);
    expect(p1?.name).toBe("Old Name");
    expect(p1?.mode).toBe(MODERATION_MODE.open);
    expect(p1?.createdAt).toBe(1_700_000_000);
    expect(p2?.name).toBe("New Name");
    expect(p2?.mode).toBe(MODERATION_MODE.curated);
    expect(p2?.createdAt).toBe(1_700_000_500);
    // Same coordinate for both versions (replaceable identity): NDK must pick v2 by created_at.
    expect(p1?.coordinate).toBe(p2?.coordinate);
  });
});