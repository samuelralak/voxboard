/**
 * Event envelope: the raw NIP-01 event shape, a builder template type, tag helpers, and the
 * relay-boundary validator. Everything in this package speaks these types so the web app and the
 * indexer agree on exactly one representation.
 */

import { z } from "zod";

/** An unsigned event as produced by a `build*` function. The signer adds pubkey, id, sig. */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** Canonical 64-char lowercase hex (an event id or pubkey). The single source of truth for this shape. */
export const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** True if `value` is canonical 64-char lowercase hex. Lowercase the input first if case-insensitive. */
export function isHex64(value: string): boolean {
  return HEX64.test(value);
}

/** NIP-01 signed event envelope. */
export const nostrEventSchema = z.object({
  id: z.string().regex(HEX64),
  pubkey: z.string().regex(HEX64),
  // Reject implausibly-far-future stamps (> ~year 2244) at the relay boundary, for BOTH the web SSR and
  // the indexer: a huge created_at otherwise makes `new Date(created_at*1000).toISOString()` throw a
  // RangeError during render (a one-event, no-signature-needed per-board DoS). Stays well under the
  // toISOString limit (8.64e12 s) while rejecting any non-legitimate value.
  created_at: z.number().int().nonnegative().max(8_640_000_000),
  kind: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(HEX128),
});

export type NostrEvent = z.infer<typeof nostrEventSchema>;

/**
 * Validate untrusted JSON into a NostrEvent at the relay boundary (used by the indexer and any
 * server-side read). NDK already hands the client typed, verified events, so client code that
 * already has an NDKEvent can call `.rawEvent()` and pass it straight to the semantic `parse*`
 * functions. This only checks the envelope shape, NOT the signature: verify the Schnorr sig
 * separately (nostr-tools `verifyEvent`) before trusting an event from an untrusted relay.
 */
export function validateNostrEvent(raw: unknown): NostrEvent | null {
  const result = nostrEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Current time in unix seconds. Builders default `created_at` to this. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Tag helpers. NIP-01: a tag is a string array; element 0 is the tag name.
// ---------------------------------------------------------------------------

/** First tag with the given name, or undefined. */
export function getTag(tags: string[][], name: string): string[] | undefined {
  return tags.find((t) => t[0] === name);
}

/** Value (element 1) of the first tag with the given name, or undefined. */
export function getTagValue(tags: string[][], name: string): string | undefined {
  const tag = getTag(tags, name);
  return tag?.[1];
}

/** All tags with the given name. */
export function getTags(tags: string[][], name: string): string[][] {
  return tags.filter((t) => t[0] === name);
}

/** Values (element 1) of every tag with the given name, dropping any without a value. */
export function getTagValues(tags: string[][], name: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] === name && t[1] !== undefined) out.push(t[1]);
  }
  return out;
}

/** The LAST tag with the given name (NIP-25: the reaction target is the last `e`/`p`/`a`). */
export function getLastTag(tags: string[][], name: string): string[] | undefined {
  for (let i = tags.length - 1; i >= 0; i--) {
    if (tags[i]?.[0] === name) return tags[i];
  }
  return undefined;
}

/**
 * Keep only well-formed tags: drop `undefined` placeholder entries (builders use them for optional
 * tags), drop tags with no name, and drop tags that declare a value slot whose value is empty or
 * undefined (e.g. an empty `["subject", ""]`). Relay hints and later positions may be empty; only the
 * value at index 1 is required when the tag has one.
 */
export function compactTags(tags: (string[] | undefined)[]): string[][] {
  const out: string[][] = [];
  for (const t of tags) {
    if (!Array.isArray(t) || t.length === 0) continue;
    if (t[0] === undefined || t[0] === "") continue;
    if (t.length >= 2 && (t[1] === undefined || t[1] === "")) continue;
    out.push(t);
  }
  return out;
}
