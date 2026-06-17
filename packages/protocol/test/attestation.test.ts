import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event.js";
import { ATTESTATION, attestationNamespace, KIND } from "../src/kinds.js";
import { communityCoordinate } from "../src/coords.js";
import {
  buildAttestationLabel,
  buildDelistLabel,
  buildAttestationSet,
  parseAttestationLabel,
  parseAttestationSet,
  verifyAttestationSet,
  attestedCoordinates,
  collapseAttestationLabels,
  isBoardAttested,
  decideAllowlist,
  selectLatestAttestationSet,
} from "../src/attestation.js";

// 64-char hex identities
const ISSUER = "f0".repeat(32); // the platform attestation key
const IMPOSTER = "ee".repeat(32);
const OWNER = "a1".repeat(32);
const OWNER2 = "a2".repeat(32);
const SLUG = "acme-feedback";
const COORD = communityCoordinate({ pubkey: OWNER, slug: SLUG });
const COORD2 = communityCoordinate({ pubkey: OWNER2, slug: "beta" });
const BOARD_EVENT = "1".repeat(64); // the board's current event id (the `e` pin)

const NS = attestationNamespace("production"); // bare base namespace
const STAGING_NS = attestationNamespace("staging"); // base + ".staging"

const SIG = "0".repeat(128);
let idCounter = 0;
function asEvent(template: EventTemplate, pubkey: string, id?: string): NostrEvent {
  const eventId = id ?? (idCounter++).toString(16).padStart(64, "0");
  return { ...template, pubkey, id: eventId, sig: SIG };
}

describe("attestation namespace (env scoping)", () => {
  it("production uses the bare base; other envs append .<env>", () => {
    expect(attestationNamespace("production")).toBe(ATTESTATION.ns);
    expect(attestationNamespace("prod")).toBe(ATTESTATION.ns);
    expect(attestationNamespace()).toBe(ATTESTATION.ns);
    expect(attestationNamespace("staging")).toBe(`${ATTESTATION.ns}.staging`);
    expect(attestationNamespace("STAGING")).toBe(`${ATTESTATION.ns}.staging`);
  });
});

describe("attestation label (carrier 2 — badge + anti-swap)", () => {
  it("round-trips coordinate, event id, attested=true, and pins the env namespace", () => {
    const event = asEvent(
      buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS }),
      ISSUER,
    );
    expect(event.kind).toBe(KIND.Label);
    expect(event.tags).toContainEqual(["L", NS]);
    expect(event.tags).toContainEqual(["l", ATTESTATION.attested, NS]);
    expect(event.tags).toContainEqual(["a", COORD]);
    expect(event.tags).toContainEqual(["e", BOARD_EVENT]);

    const label = parseAttestationLabel(event, NS);
    expect(label).not.toBeNull();
    expect(label!.coordinate).toBe(COORD);
    expect(label!.eventId).toBe(BOARD_EVENT);
    expect(label!.attested).toBe(true);
    expect(label!.pubkey).toBe(ISSUER);
  });

  it("delist label parses as attested=false (the off-state)", () => {
    const event = asEvent(buildDelistLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS }), ISSUER);
    const label = parseAttestationLabel(event, NS);
    expect(label!.attested).toBe(false);
  });

  it("does NOT match under a different env namespace (staging label is not a prod label)", () => {
    const staging = asEvent(
      buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: STAGING_NS }),
      ISSUER,
    );
    expect(parseAttestationLabel(staging, NS)).toBeNull(); // pinned on the full L/l tag
    expect(parseAttestationLabel(staging, STAGING_NS)).not.toBeNull();
  });

  it("rejects a label that pins a non-board coordinate, or is missing the a/e pins", () => {
    const wrongKindCoord = asEvent(
      buildAttestationLabel({ coordinate: `1111:${OWNER}:x`, eventId: BOARD_EVENT, namespace: NS }),
      ISSUER,
    );
    expect(parseAttestationLabel(wrongKindCoord, NS)).toBeNull();

    const noEventPin: NostrEvent = {
      ...asEvent(buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS }), ISSUER),
      tags: [["L", NS], ["l", ATTESTATION.attested, NS], ["a", COORD]], // no `e`
    };
    expect(parseAttestationLabel(noEventPin, NS)).toBeNull();
  });
});

describe("attestation set (carrier 1 — the discover allowlist)", () => {
  it("round-trips the coordinate list, d identifier, and namespace; de-dupes", () => {
    const event = asEvent(
      buildAttestationSet({ coordinates: [COORD, COORD2, COORD], namespace: NS }),
      ISSUER,
    );
    expect(event.kind).toBe(ATTESTATION.setKind);
    expect(event.tags).toContainEqual(["d", ATTESTATION.setIdentifier]);
    expect(event.tags).toContainEqual(["L", NS]);
    expect(event.tags).toContainEqual(["l", ATTESTATION.attested, NS]);
    // de-duped: COORD appears once
    expect(event.tags.filter((t) => t[0] === "a" && t[1] === COORD)).toHaveLength(1);

    const set = parseAttestationSet(event, NS);
    expect(set!.coordinates).toEqual([COORD, COORD2]);
  });

  it("filters out malformed / non-board coordinates defensively", () => {
    const event: NostrEvent = {
      ...asEvent(buildAttestationSet({ coordinates: [COORD], namespace: NS }), ISSUER),
      tags: [
        ["d", ATTESTATION.setIdentifier],
        ["L", NS],
        ["l", ATTESTATION.attested, NS],
        ["a", COORD],
        ["a", "not-a-coordinate"],
        ["a", `1111:${OWNER}:idea`], // wrong kind
      ],
    };
    const set = parseAttestationSet(event, NS);
    expect(set!.coordinates).toEqual([COORD]);
  });

  it("rejects the wrong d identifier, wrong namespace, or wrong kind", () => {
    const base = buildAttestationSet({ coordinates: [COORD], namespace: NS });
    const wrongD: NostrEvent = { ...asEvent(base, ISSUER), tags: base.tags.map((t) => (t[0] === "d" ? ["d", "other"] : t)) };
    expect(parseAttestationSet(wrongD, NS)).toBeNull();

    const staging = asEvent(buildAttestationSet({ coordinates: [COORD], namespace: STAGING_NS }), ISSUER);
    expect(parseAttestationSet(staging, NS)).toBeNull();

    const wrongKind: NostrEvent = { ...asEvent(base, ISSUER), kind: KIND.Label };
    expect(parseAttestationSet(wrongKind, NS)).toBeNull();
  });

  it("verifyAttestationSet pins the issuer pubkey and yields a membership Set", () => {
    const event = asEvent(buildAttestationSet({ coordinates: [COORD, COORD2], namespace: NS }), ISSUER);
    expect(verifyAttestationSet(event, IMPOSTER, NS)).toBeNull(); // not the issuer

    const set = verifyAttestationSet(event, ISSUER, NS);
    expect(set).not.toBeNull();
    const allowed = attestedCoordinates(set!);
    expect(allowed.has(COORD)).toBe(true);
    expect(allowed.has(COORD2)).toBe(true);
    expect(allowed.has(communityCoordinate({ pubkey: OWNER, slug: "ghost" }))).toBe(false);
  });

  it("verifyAttestationSet matches the issuer case-insensitively", () => {
    const event = asEvent(buildAttestationSet({ coordinates: [COORD], namespace: NS }), ISSUER);
    expect(verifyAttestationSet(event, ISSUER.toUpperCase(), NS)).not.toBeNull();
  });
});

describe("selectLatestAttestationSet (shared latest-wins selection)", () => {
  it("picks the newest created_at, dropping foreign-issuer and wrong-namespace sets", () => {
    const old = asEvent(buildAttestationSet({ coordinates: [COORD], namespace: NS, createdAt: 100 }), ISSUER);
    const newer = asEvent(buildAttestationSet({ coordinates: [COORD, COORD2], namespace: NS, createdAt: 200 }), ISSUER);
    const foreign = asEvent(buildAttestationSet({ coordinates: [COORD], namespace: NS, createdAt: 300 }), IMPOSTER);
    const staging = asEvent(buildAttestationSet({ coordinates: [COORD], namespace: STAGING_NS, createdAt: 300 }), ISSUER);
    const latest = selectLatestAttestationSet([old, newer, foreign, staging], ISSUER, NS);
    expect(latest?.coordinates).toEqual([COORD, COORD2]); // the issuer's newest in-namespace set
  });

  it("tiebreaks an equal created_at by lowest event id (deterministic across readers)", () => {
    const lowId = asEvent(buildAttestationSet({ coordinates: [COORD], namespace: NS, createdAt: 100 }), ISSUER, "0".repeat(63) + "1");
    const highId = asEvent(buildAttestationSet({ coordinates: [COORD, COORD2], namespace: NS, createdAt: 100 }), ISSUER, "f".repeat(64));
    expect(selectLatestAttestationSet([highId, lowId], ISSUER, NS)?.coordinates).toEqual([COORD]); // lowest id wins
  });

  it("returns null when nothing verifies", () => {
    expect(selectLatestAttestationSet([], ISSUER, NS)).toBeNull();
  });
});

describe("coordinate canonicalization on parse", () => {
  it("parseAttestationSet lowercases the pubkey segment and de-dupes case-variants of the same board", () => {
    const event: NostrEvent = {
      ...asEvent(buildAttestationSet({ coordinates: [COORD], namespace: NS }), ISSUER),
      tags: [
        ["d", ATTESTATION.setIdentifier],
        ["L", NS],
        ["l", ATTESTATION.attested, NS],
        ["a", `34550:${OWNER.toUpperCase()}:${SLUG}`], // uppercase pubkey, same board as COORD
        ["a", COORD],
      ],
    };
    const set = parseAttestationSet(event, NS);
    expect(set?.coordinates).toEqual([COORD]); // canonicalized + de-duped to one
  });

  it("parseAttestationLabel canonicalizes the coordinate", () => {
    const event = asEvent(
      buildAttestationLabel({ coordinate: `34550:${OWNER.toUpperCase()}:${SLUG}`, eventId: BOARD_EVENT, namespace: NS }),
      ISSUER,
    );
    expect(parseAttestationLabel(event, NS)?.coordinate).toBe(COORD);
  });
});

describe("decideAllowlist (discover fail mode)", () => {
  const cache = new Set([COORD]);

  it("applies no filter when attestation is not configured", () => {
    expect(decideAllowlist({ configured: false, latestCoords: null, responded: 0, cache: null })).toEqual({
      coords: null,
      source: "unconfigured",
    });
  });

  it("filters to the verified set's coordinates on a live read", () => {
    const d = decideAllowlist({ configured: true, latestCoords: [COORD, COORD2], responded: 3, cache: null });
    expect(d.source).toBe("live");
    expect([...(d.coords ?? [])]).toEqual([COORD, COORD2]);
  });

  it("shows nothing when relays responded but no set exists (genuinely empty)", () => {
    const d = decideAllowlist({ configured: true, latestCoords: null, responded: 2, cache });
    expect(d.source).toBe("empty");
    expect(d.coords?.size).toBe(0);
  });

  it("uses last-known-good cache on a blind read", () => {
    const d = decideAllowlist({ configured: true, latestCoords: null, responded: 0, cache });
    expect(d.source).toBe("cache");
    expect(d.coords).toBe(cache);
  });

  it("fails OPEN on a blind read with no cache (never blanks discover on a total outage)", () => {
    const d = decideAllowlist({ configured: true, latestCoords: null, responded: 0, cache: null });
    expect(d.source).toBe("open-blind");
    expect(d.coords).toBeNull();
  });
});

describe("per-board badge collapse (anti-swap)", () => {
  it("latest issuer label wins: a later delist supersedes an earlier attest", () => {
    const attested = asEvent(
      buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS, createdAt: 100 }),
      ISSUER,
    );
    const delisted = asEvent(
      buildDelistLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS, createdAt: 200 }),
      ISSUER,
    );
    expect(isBoardAttested([attested], ISSUER, NS, COORD, BOARD_EVENT)).toBe(true);
    expect(isBoardAttested([attested, delisted], ISSUER, NS, COORD, BOARD_EVENT)).toBe(false);
  });

  it("auto-revokes when the board is edited (the `e` pin no longer matches)", () => {
    const attested = asEvent(
      buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS }),
      ISSUER,
    );
    const editedBoardEventId = "2".repeat(64);
    expect(isBoardAttested([attested], ISSUER, NS, COORD, BOARD_EVENT)).toBe(true);
    expect(isBoardAttested([attested], ISSUER, NS, COORD, editedBoardEventId)).toBe(false);
  });

  it("ignores labels not authored by the pinned issuer (anti-forgery)", () => {
    const forged = asEvent(
      buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS }),
      IMPOSTER,
    );
    expect(isBoardAttested([forged], ISSUER, NS, COORD, BOARD_EVENT)).toBe(false);
    expect(collapseAttestationLabels([forged], ISSUER, NS).size).toBe(0);
  });

  it("tiebreaks equal created_at by lowest event id (NIP-01)", () => {
    const lowIdDelist = asEvent(
      buildDelistLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS, createdAt: 100 }),
      ISSUER,
      "0".repeat(63) + "1",
    );
    const highIdAttest = asEvent(
      buildAttestationLabel({ coordinate: COORD, eventId: BOARD_EVENT, namespace: NS, createdAt: 100 }),
      ISSUER,
      "f".repeat(64),
    );
    // same created_at => lowest id wins => the delist
    expect(isBoardAttested([highIdAttest, lowIdDelist], ISSUER, NS, COORD, BOARD_EVENT)).toBe(false);
  });
});
