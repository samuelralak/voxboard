import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";
import {
  attestationNamespace,
  buildAttestationLabel,
  buildAttestationSet,
  communityCoordinate,
  isBoardAttested,
  parseAttestationLabel,
  parseAttestationSet,
  type NostrEvent,
} from "@voxboard/protocol";
import { createSigner } from "../src/signer.js";
import { issueAttestation, revokeAttestation } from "../src/issue.js";
import { fakeRelays } from "./fake-relays.js";

const issuerSk = generateSecretKey();
const signer = createSigner({ ATTESTATION_PRIVATE_KEY: bytesToHex(issuerSk) });
const NS = attestationNamespace("test");

const owner = getPublicKey(generateSecretKey());
const coordOf = (slug: string) => communityCoordinate({ pubkey: owner, slug });
const A = coordOf("a");
const B = coordOf("b");
const C = coordOf("c");
const EV = (c: string) => c.repeat(64);

function makeDeps(seed: NostrEvent[] = []) {
  const fr = fakeRelays(seed);
  return { fr, deps: { signer, client: fr.client, namespace: NS } };
}

describe("issueAttestation (ADD)", () => {
  it("publishes a label + a set containing the coordinate on a genesis add", async () => {
    const { deps } = makeDeps();
    const res = await issueAttestation({ coordinate: A, eventId: EV("1") }, deps);
    expect(res.idempotent).toBe(false);
    expect(res.coordinates).toEqual([A]);
    const label = parseAttestationLabel(res.label as NostrEvent, NS);
    expect(label?.coordinate).toBe(A);
    expect(label?.eventId).toBe(EV("1"));
    expect(label?.attested).toBe(true);
    expect(parseAttestationSet(res.set as NostrEvent, NS)?.coordinates).toEqual([A]);
  });

  it("is idempotent when the board is already attested at the same event id", async () => {
    const { fr, deps } = makeDeps();
    await issueAttestation({ coordinate: A, eventId: EV("1") }, deps);
    const afterFirst = fr.published.length;
    const res = await issueAttestation({ coordinate: A, eventId: EV("1") }, deps);
    expect(res.idempotent).toBe(true);
    expect(res.set).toBeNull();
    expect(fr.published.length).toBe(afterFirst); // nothing new published
  });

  it("is MONOTONIC: set present but labels read empty still preserves listed boards", async () => {
    const existingSet = signer.sign(buildAttestationSet({ coordinates: [A, B], namespace: NS }));
    const { deps } = makeDeps([existingSet]);
    const res = await issueAttestation({ coordinate: C, eventId: EV("3") }, deps);
    expect(new Set(res.coordinates)).toEqual(new Set([A, B, C])); // A, B not dropped
  });

  it("is MONOTONIC the other way: set read empty but labels present", async () => {
    const labelA = signer.sign(buildAttestationLabel({ coordinate: A, eventId: EV("1"), namespace: NS }));
    const labelB = signer.sign(buildAttestationLabel({ coordinate: B, eventId: EV("2"), namespace: NS }));
    const { deps } = makeDeps([labelA, labelB]);
    const res = await issueAttestation({ coordinate: C, eventId: EV("3") }, deps);
    expect(new Set(res.coordinates)).toEqual(new Set([A, B, C]));
  });

  it("on a board-edit re-attest, republishes the label (new event id) but not the set (coords unchanged)", async () => {
    const { fr, deps } = makeDeps();
    await issueAttestation({ coordinate: A, eventId: EV("1") }, deps);
    const before = fr.published.length;
    const res = await issueAttestation({ coordinate: A, eventId: EV("2") }, deps);
    expect(res.idempotent).toBe(false);
    expect(parseAttestationLabel(res.label as NostrEvent, NS)?.eventId).toBe(EV("2"));
    expect(res.set).toBeNull(); // membership unchanged => no set churn
    expect(fr.published.length).toBe(before + 1); // only the new label
  });
});

describe("revokeAttestation (REVOKE)", () => {
  it("publishes a delist label and a set without the coordinate", async () => {
    const labelA = signer.sign(buildAttestationLabel({ coordinate: A, eventId: EV("1"), namespace: NS }));
    const labelB = signer.sign(buildAttestationLabel({ coordinate: B, eventId: EV("2"), namespace: NS }));
    const set = signer.sign(buildAttestationSet({ coordinates: [A, B], namespace: NS }));
    const { deps } = makeDeps([labelA, labelB, set]);
    const res = await revokeAttestation({ coordinate: B }, deps);
    expect(res.coordinates).toEqual([A]);
    const delist = parseAttestationLabel(res.label as NostrEvent, NS);
    expect(delist?.coordinate).toBe(B);
    expect(delist?.attested).toBe(false); // the off-state
    expect(parseAttestationSet(res.set as NostrEvent, NS)?.coordinates).toEqual([A]);
  });

  it("removes the coordinate while preserving others via the union floor", async () => {
    const labelA = signer.sign(buildAttestationLabel({ coordinate: A, eventId: EV("1"), namespace: NS }));
    const set = signer.sign(buildAttestationSet({ coordinates: [A, B], namespace: NS }));
    const { deps } = makeDeps([labelA, set]); // labels know only A; set knows A,B
    const res = await revokeAttestation({ coordinate: B, eventId: EV("2") }, deps);
    expect(new Set(res.coordinates)).toEqual(new Set([A]));
  });

  it("forces the delist label strictly newer than the attested label (no same-second tie)", async () => {
    const T = 2_000_000_000; // a fixed timestamp above now() so the bump is deterministic
    const attestedB = signer.sign(buildAttestationLabel({ coordinate: B, eventId: EV("2"), namespace: NS, createdAt: T }));
    const set = signer.sign(buildAttestationSet({ coordinates: [A, B], namespace: NS, createdAt: T }));
    const { deps } = makeDeps([attestedB, set]);
    const res = await revokeAttestation({ coordinate: B }, deps);
    const delist = parseAttestationLabel(res.label as NostrEvent, NS);
    expect(delist?.createdAt).toBe(T + 1); // strictly supersedes the attested label
    expect(delist?.attested).toBe(false);
    // collapse now resolves B to delisted (the off-state wins the tie)
    expect(isBoardAttested([attestedB, res.label as NostrEvent], signer.issuerPubkey, NS, B, EV("2"))).toBe(false);
  });
});

describe("issueAttestation safety guards", () => {
  it("FAILS CLOSED on a blind read (zero reachable relays) instead of publishing a shrunken set", async () => {
    const existingSet = signer.sign(buildAttestationSet({ coordinates: [A, B], namespace: NS }));
    const fr = fakeRelays([existingSet], { responded: 0 });
    await expect(
      issueAttestation({ coordinate: C, eventId: EV("3") }, { signer, client: fr.client, namespace: NS }),
    ).rejects.toThrow(/blind/i);
    expect(fr.published).toHaveLength(0); // nothing was published
  });

  it("throws when a publish reaches no relay (failure is not silently reported as success)", async () => {
    const fr = fakeRelays([], { publishOk: 0 });
    await expect(
      issueAttestation({ coordinate: A, eventId: EV("1") }, { signer, client: fr.client, namespace: NS }),
    ).rejects.toThrow(/publish/i);
  });
});
