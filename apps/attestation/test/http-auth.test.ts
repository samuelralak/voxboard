import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { buildHttpAuth, sha256Hex, type NostrEvent } from "@voxboard/protocol";
import { verifyHttpAuth } from "../src/http-auth.js";

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const URL_ = "https://attestation.test/v1/attest";
const BODY = JSON.stringify({ coordinate: "34550:" + "ab".repeat(32) + ":demo" });
const PAYLOAD = sha256Hex(BODY);
const NOW = 1_800_000_000;

/** Sign a NIP-98 event and wrap it in the Authorization header value. */
function token(overrides: Partial<{ url: string; method: string; payload: string; createdAt: number }> = {}): string {
  const event = finalizeEvent(
    buildHttpAuth({
      url: overrides.url ?? URL_,
      method: overrides.method ?? "POST",
      payload: overrides.payload ?? PAYLOAD,
      createdAt: overrides.createdAt ?? NOW,
    }),
    sk,
  ) as NostrEvent;
  return "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
}

const expectGood = { url: URL_, method: "POST", now: NOW, payloadHash: PAYLOAD };

describe("verifyHttpAuth", () => {
  it("accepts a valid token and returns the requester pubkey", () => {
    const result = verifyHttpAuth(token(), expectGood);
    expect(result).toEqual({ ok: true, pubkey });
  });

  it("rejects a missing or non-Nostr Authorization header", () => {
    expect(verifyHttpAuth(undefined, expectGood).ok).toBe(false);
    expect(verifyHttpAuth("Bearer xyz", expectGood).ok).toBe(false);
  });

  it("rejects a token that is not base64 JSON", () => {
    expect(verifyHttpAuth("Nostr @@@not-base64@@@", expectGood).ok).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const event = finalizeEvent(buildHttpAuth({ url: URL_, method: "POST", payload: PAYLOAD, createdAt: NOW }), sk) as NostrEvent;
    const forged = { ...event, sig: "0".repeat(128) };
    const header = "Nostr " + Buffer.from(JSON.stringify(forged)).toString("base64");
    expect(verifyHttpAuth(header, expectGood).ok).toBe(false);
  });

  it("rejects a stale or future-dated token", () => {
    expect(verifyHttpAuth(token({ createdAt: NOW - 120 }), expectGood).ok).toBe(false);
    expect(verifyHttpAuth(token({ createdAt: NOW + 120 }), expectGood).ok).toBe(false);
  });

  it("rejects a method or url mismatch", () => {
    expect(verifyHttpAuth(token({ method: "GET" }), expectGood).ok).toBe(false);
    expect(verifyHttpAuth(token({ url: "https://evil.test/v1/attest" }), expectGood).ok).toBe(false);
  });

  it("rejects a payload-hash mismatch (token signed for a different body)", () => {
    const otherBody = JSON.stringify({ coordinate: "34550:" + "cd".repeat(32) + ":other" });
    const result = verifyHttpAuth(token({ payload: sha256Hex(otherBody) }), expectGood);
    expect(result.ok).toBe(false);
  });

  it("rejects a token carrying NO payload tag (body binding is mandatory)", () => {
    const event = finalizeEvent(buildHttpAuth({ url: URL_, method: "POST", createdAt: NOW }), sk) as NostrEvent; // no payload
    const header = "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
    expect(verifyHttpAuth(header, expectGood).ok).toBe(false);
  });

  it("rejects a non-27235 kind", () => {
    const event = finalizeEvent({ kind: 1, created_at: NOW, tags: [["u", URL_], ["method", "POST"]], content: "" }, sk) as NostrEvent;
    const header = "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
    expect(verifyHttpAuth(header, expectGood).ok).toBe(false);
  });
});
