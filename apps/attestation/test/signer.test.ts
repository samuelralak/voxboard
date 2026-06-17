import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";
import * as nip19 from "nostr-tools/nip19";
import { attestationNamespace, buildAttestationLabel } from "@voxboard/protocol";
import { createSigner } from "../src/signer.js";

describe("attestation signer", () => {
  const sk = generateSecretKey();
  const skHex = bytesToHex(sk);
  const pk = getPublicKey(sk);

  it("derives the issuer pubkey from a hex key", () => {
    expect(createSigner({ ATTESTATION_PRIVATE_KEY: skHex }).issuerPubkey).toBe(pk);
  });

  it("derives the issuer pubkey from an nsec key", () => {
    expect(createSigner({ ATTESTATION_PRIVATE_KEY: nip19.nsecEncode(sk) }).issuerPubkey).toBe(pk);
  });

  it("signs a template into a verifiable event authored by the issuer", () => {
    const signer = createSigner({ ATTESTATION_PRIVATE_KEY: skHex });
    const ns = attestationNamespace("test");
    const template = buildAttestationLabel({
      coordinate: `34550:${pk}:demo`,
      eventId: "a".repeat(64),
      namespace: ns,
    });
    const event = signer.sign(template);
    expect(event.pubkey).toBe(pk);
    expect(event.id).toMatch(/^[0-9a-f]{64}$/);
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyEvent(event)).toBe(true);
  });

  it("throws when the key is missing or malformed (fail closed)", () => {
    expect(() => createSigner({})).toThrow();
    expect(() => createSigner({ ATTESTATION_PRIVATE_KEY: "" })).toThrow();
    expect(() => createSigner({ ATTESTATION_PRIVATE_KEY: "not-a-key" })).toThrow();
    expect(() => createSigner({ ATTESTATION_PRIVATE_KEY: "z".repeat(64) })).toThrow();
  });

  it("rejects an ATTESTATION_PUBKEY that does not match the secret, accepts one that does", () => {
    expect(() =>
      createSigner({ ATTESTATION_PRIVATE_KEY: skHex, ATTESTATION_PUBKEY: "b".repeat(64) }),
    ).toThrow();
    expect(
      createSigner({ ATTESTATION_PRIVATE_KEY: skHex, ATTESTATION_PUBKEY: pk.toUpperCase() }).issuerPubkey,
    ).toBe(pk);
  });
});
