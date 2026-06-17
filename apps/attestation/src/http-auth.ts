/**
 * Server-side NIP-98 verification: decode the `Authorization: Nostr <base64>` header, verify the Schnorr
 * signature, and pin freshness + url + method + payload. Returns the authenticated requester pubkey only
 * when EVERYTHING checks out, so the attestation endpoints can trust `auth.pubkey` as the caller identity.
 *
 * Replay note: a valid token can be replayed within the freshness window, but the payload pin binds it to
 * one specific body (one coordinate) and the underlying attest/revoke ops are idempotent, so a replay is a
 * no-op. A stricter nonce/seen-cache is a later hardening.
 */

import { verifyEvent } from "nostr-tools/pure";
import { parseHttpAuth, validateNostrEvent, type NostrEvent } from "@voxboard/protocol";

const DEFAULT_MAX_AGE_SEC = 60;

export interface AuthExpectation {
  /** the absolute URL the server reconstructs for this request (must equal the signed `u`) */
  url: string;
  method: string;
  /** current unix seconds (injected for testability) */
  now: number;
  maxAgeSec?: number;
  /**
   * sha256 hex of the received body; the auth event's `payload` MUST equal it. REQUIRED so body binding is
   * never accidentally skipped — a body-less route must pass sha256Hex("") explicitly.
   */
  payloadHash: string;
}

export type AuthResult = { ok: true; pubkey: string } | { ok: false; reason: string };

export function verifyHttpAuth(header: string | null | undefined, expect: AuthExpectation): AuthResult {
  if (!header) return { ok: false, reason: "missing Authorization header" };
  const match = /^Nostr\s+(.+)$/i.exec(header.trim());
  if (!match || !match[1]) return { ok: false, reason: "Authorization is not a Nostr token" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "auth token is not base64-encoded JSON" };
  }

  const event = validateNostrEvent(decoded);
  if (!event) return { ok: false, reason: "auth event envelope invalid" };
  if (!verifyEvent(event as NostrEvent & { sig: string })) return { ok: false, reason: "auth signature invalid" };

  const auth = parseHttpAuth(event);
  if (!auth) return { ok: false, reason: "not a NIP-98 (kind 27235) auth event" };

  const maxAge = expect.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;
  if (Math.abs(expect.now - auth.createdAt) > maxAge) return { ok: false, reason: "auth event stale or future-dated" };
  if (auth.method !== expect.method.toUpperCase()) return { ok: false, reason: "auth method mismatch" };
  if (!sameUrl(auth.url, expect.url)) return { ok: false, reason: "auth url mismatch" };
  // mandatory body binding: a missing or mismatched payload tag is always rejected
  if (auth.payload !== expect.payloadHash) return { ok: false, reason: "auth payload hash mismatch" };

  return { ok: true, pubkey: event.pubkey };
}

/** Compare two URLs by origin + path + query, tolerating trivial formatting differences. */
function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.origin.toLowerCase() === ub.origin.toLowerCase() &&
      ua.pathname === ub.pathname &&
      ua.search === ub.search
    );
  } catch {
    return a === b;
  }
}
