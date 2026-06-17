/**
 * NIP-98 HTTP auth (kind 27235): a short-lived event a client signs to authenticate a request to a
 * privileged endpoint — here, the attestation trigger. The event pins the request URL (`u`) and method
 * (`method`), and for requests with a body it pins a sha256 of the body (`payload`) so a captured auth
 * token can't be replayed against a DIFFERENT body (e.g. swapping the board coordinate).
 *
 * These are PURE builders/parsers (no signature verification) — the same boundary discipline as the rest
 * of @voxboard/protocol. The server verifies the Schnorr signature, freshness, and the url/method/payload
 * pins (see apps/attestation/src/http-auth.ts). The web client signs buildHttpAuth(...) with the user's key.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { KIND } from "./kinds";
import { type EventTemplate, type NostrEvent, compactTags, getTagValue, now } from "./event";

const encoder = new TextEncoder();

/** sha256 hex of a UTF-8 string — the NIP-98 `payload` body hash, computed identically on client + server. */
export function sha256Hex(data: string): string {
  return bytesToHex(sha256(encoder.encode(data)));
}

export interface HttpAuthInput {
  /** the absolute request URL the auth is scoped to */
  url: string;
  /** the HTTP method (normalized to uppercase) */
  method: string;
  /** optional sha256 hex of the request body (use sha256Hex); pins the auth to a specific body */
  payload?: string;
  createdAt?: number;
}

/** Build an unsigned NIP-98 auth event template. The caller signs it with the requester's key. */
export function buildHttpAuth(input: HttpAuthInput): EventTemplate {
  return {
    kind: KIND.HttpAuth,
    created_at: input.createdAt ?? now(),
    tags: compactTags([
      ["u", input.url],
      ["method", input.method.toUpperCase()],
      input.payload ? ["payload", input.payload] : undefined,
    ]),
    content: "",
  };
}

export interface HttpAuth {
  /** the authenticated requester pubkey (hex) — trustworthy only AFTER the caller verifies the signature */
  pubkey: string;
  url: string;
  method: string;
  payload?: string;
  createdAt: number;
  raw: NostrEvent;
}

/** Structural parse of a NIP-98 event (no signature check). Returns null if it isn't a well-formed 27235. */
export function parseHttpAuth(event: NostrEvent): HttpAuth | null {
  if (event.kind !== KIND.HttpAuth) return null;
  const url = getTagValue(event.tags, "u");
  const method = getTagValue(event.tags, "method");
  if (!url || !method) return null;
  return {
    pubkey: event.pubkey,
    url,
    method: method.toUpperCase(),
    payload: getTagValue(event.tags, "payload"),
    createdAt: event.created_at,
    raw: event,
  };
}
