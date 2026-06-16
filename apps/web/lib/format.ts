import * as nip19 from "nostr-tools/nip19";
import { sanitizeLine } from "@voxboard/protocol";

/** A display name from an untrusted profile, with bidi/zero-width/control characters neutralized. */
export function cleanName(name: string | undefined): string {
  return name ? sanitizeLine(name) : "";
}

/** A short, recognizable npub like `npub1a1b…q9x7`. Falls back to a hex prefix. */
export function npubShort(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
  } catch {
    return pubkey.slice(0, 10);
  }
}

/** Compact relative time: 12s, 5m, 3h, 2d, 4w, 6mo, 1y. */
export function timeAgo(unixSeconds: number, nowMs = Date.now()): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** ISO 8601 timestamp (UTC) for a <time dateTime> attribute. Deterministic, so SSR-safe. Returns "" for
 *  an out-of-range stamp: `toISOString()` THROWS a RangeError past ±8.64e15ms, so a relay-supplied
 *  created_at could otherwise crash the whole SSR render (the protocol schema now also bounds it). */
export function isoTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Full UTC timestamp for a hover title (e.g. "Sun, 15 Jun 2026 ..."). Deterministic, so SSR-safe. */
export function fullTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toUTCString();
}

/** Compact counts, sign-preserving: 1, 42, 1.2k, 12k, 1.1m, and -1.2m for a deeply downvoted score. */
export function formatCount(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a < 1000) return String(n);
  if (a < 10_000) return `${sign}${(a / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (a < 1_000_000) return `${sign}${Math.round(a / 1000)}k`;
  return `${sign}${(a / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/** Sats totals, compact. */
export function formatSats(sats: number): string {
  return formatCount(sats);
}
