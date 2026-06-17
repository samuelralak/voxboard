import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";
import { now, sha256Hex } from "@voxboard/protocol";
import { createSigner } from "../src/signer.js";
import { operatorAuthHeader } from "../src/cli.js";
import { verifyHttpAuth } from "../src/http-auth.js";

describe("operator CLI auth", () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = createSigner({ ATTESTATION_PRIVATE_KEY: bytesToHex(sk) });
  const url = "https://attestation.test/v1/revoke";
  const body = JSON.stringify({ coordinate: "34550:" + "ab".repeat(32) + ":demo" });

  it("produces a NIP-98 header the server verifier accepts (payload-bound, operator pubkey)", () => {
    const header = operatorAuthHeader(signer, url, body);
    const result = verifyHttpAuth(header, { url, method: "POST", now: now(), payloadHash: sha256Hex(body) });
    expect(result).toEqual({ ok: true, pubkey });
  });

  it("binds to the exact body (a token for a different body fails the payload pin)", () => {
    const header = operatorAuthHeader(signer, url, body);
    const result = verifyHttpAuth(header, {
      url,
      method: "POST",
      now: now(),
      payloadHash: sha256Hex(JSON.stringify({ coordinate: "different" })),
    });
    expect(result.ok).toBe(false);
  });

  it("binds to the exact url (a token for a different endpoint fails)", () => {
    const header = operatorAuthHeader(signer, url, body);
    const result = verifyHttpAuth(header, {
      url: "https://attestation.test/v1/attest",
      method: "POST",
      now: now(),
      payloadHash: sha256Hex(body),
    });
    expect(result.ok).toBe(false);
  });
});
