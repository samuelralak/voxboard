import { describe, it, expect, beforeEach } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { matchFilter } from "nostr-tools/filter";
import {
  attestationNamespace,
  buildAttestationLabel,
  buildAttestationSet,
  buildBoard,
  communityCoordinate,
  type NostrEvent,
} from "@voxboard/protocol";
import type { SimplePool } from "nostr-tools/pool";

// Configure the deployment's trusted issuer + env-scoped namespace BEFORE importing the SSR module (its
// helpers read process.env at call time, but set them up front for clarity).
const issuerSk = generateSecretKey();
const issuer = getPublicKey(issuerSk);
process.env.ATTESTATION_PUBKEY = issuer;
process.env.ATTESTATION_ENV = "test";
const NS = attestationNamespace("test");

const { fetchDiscoverBoards, fetchBoardSnapshotImpl } = await import("@/lib/nostr/server");
const { __resetAllowlistCacheForTest } = await import("@/lib/nostr/attestation-gate");

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const board = (slug: string, name: string): NostrEvent => finalizeEvent(buildBoard({ slug, name }), ownerSk) as NostrEvent;
const coordOf = (slug: string) => communityCoordinate({ pubkey: owner, slug });

/** A fake SimplePool: querySync matchFilter over a seed store; listConnectionStatus reports reachability. */
function fakePool(store: NostrEvent[], connected = true): SimplePool {
  return {
    async querySync(_relays: string[], filter: unknown) {
      return store.filter((e) => matchFilter(filter as never, e as never));
    },
    listConnectionStatus() {
      return new Map<string, boolean>([["wss://relay.primal.net", connected]]);
    },
    publish() {
      return [];
    },
    close() {},
  } as unknown as SimplePool;
}

beforeEach(() => __resetAllowlistCacheForTest());

describe("fetchDiscoverBoards — strict allowlist filter", () => {
  it("returns ONLY attested boards when a verified issuer set is present", async () => {
    const boardA = board("a", "Alpha");
    const boardB = board("b", "Beta");
    const set = finalizeEvent(buildAttestationSet({ coordinates: [coordOf("a")], namespace: NS }), issuerSk) as NostrEvent;
    const result = await fetchDiscoverBoards(30, [], fakePool([boardA, boardB, set]));
    expect(result.map((b) => b.coordinate)).toEqual([coordOf("a")]); // Beta excluded
  });

  it("does NOT trust a FORGED-signature set (a relay can't inject attested coordinates)", async () => {
    const boardA = board("a", "Alpha");
    const realSet = finalizeEvent(buildAttestationSet({ coordinates: [coordOf("a")], namespace: NS }), issuerSk) as NostrEvent;
    const forgedSet: NostrEvent = { ...realSet, sig: "0".repeat(128) }; // valid shape, invalid Schnorr
    const result = await fetchDiscoverBoards(30, [], fakePool([boardA, forgedSet]));
    expect(result).toEqual([]); // forged set fails verifyEvent => empty allowlist => nothing
  });

  it("falls back to unfiltered recent boards when attestation is not configured", async () => {
    const saved = process.env.ATTESTATION_PUBKEY;
    delete process.env.ATTESTATION_PUBKEY;
    try {
      const result = await fetchDiscoverBoards(30, [], fakePool([board("a", "Alpha"), board("b", "Beta")]));
      expect(result.map((b) => b.coordinate).sort()).toEqual([coordOf("a"), coordOf("b")].sort());
    } finally {
      process.env.ATTESTATION_PUBKEY = saved;
    }
  });
});

describe("fetchBoardSnapshot — Attested badge (forgery-resistant)", () => {
  it("sets attested=true for a real issuer label pinning the current board version", async () => {
    const boardA = board("a", "Alpha");
    const label = finalizeEvent(
      buildAttestationLabel({ coordinate: coordOf("a"), eventId: boardA.id, namespace: NS }),
      issuerSk,
    ) as NostrEvent;
    const snap = await fetchBoardSnapshotImpl(coordOf("a"), [], fakePool([boardA, label]));
    expect(snap.attested).toBe(true);
  });

  it("sets attested=false for a FORGED-signature issuer label (no fake badge)", async () => {
    const boardA = board("a", "Alpha");
    const real = finalizeEvent(
      buildAttestationLabel({ coordinate: coordOf("a"), eventId: boardA.id, namespace: NS }),
      issuerSk,
    ) as NostrEvent;
    const forged: NostrEvent = { ...real, sig: "0".repeat(128) };
    const snap = await fetchBoardSnapshotImpl(coordOf("a"), [], fakePool([boardA, forged]));
    expect(snap.attested).toBe(false);
  });

  it("sets attested=false when the label pins a DIFFERENT board version (anti-swap)", async () => {
    const boardA = board("a", "Alpha");
    const staleLabel = finalizeEvent(
      buildAttestationLabel({ coordinate: coordOf("a"), eventId: "f".repeat(64), namespace: NS }),
      issuerSk,
    ) as NostrEvent;
    const snap = await fetchBoardSnapshotImpl(coordOf("a"), [], fakePool([boardA, staleLabel]));
    expect(snap.attested).toBe(false);
  });
});
