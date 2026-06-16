/**
 * Bridge between NDK events and the framework-agnostic @voxboard/protocol model. NDK hands us
 * NDKEvent instances (already signature-verified by the pool); the protocol parsers want plain
 * NIP-01 events, so we map across this boundary in one place.
 */

import type { NDKEvent, NDKFilter } from "@nostr-dev-kit/ndk";
import type { NostrEvent } from "@voxboard/protocol";

/** A plain Nostr filter shape. */
export type VoxFilter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
} & { [tag: `#${string}`]: string[] | undefined };

/**
 * Build an NDKFilter from a plain filter. NDK types `kinds` as its `NDKKind` enum, so this centralizes
 * the (safe) cast for our plain numeric kinds (e.g. 34550, 1111) in one place.
 */
export function ndkFilter(filter: VoxFilter): NDKFilter {
  return filter as NDKFilter;
}

/** Map an NDKEvent to a plain NostrEvent, or null if it is missing required fields. */
export function toNostrEvent(event: NDKEvent): NostrEvent | null {
  const { id, pubkey, sig, kind, content } = event;
  if (!id || !pubkey || !sig || kind === undefined) return null;
  return {
    id,
    pubkey,
    sig,
    kind,
    content: content ?? "",
    created_at: event.created_at ?? 0,
    tags: event.tags,
  };
}

/** Map a list of NDKEvents to NostrEvents, dropping any that are malformed. */
export function toNostrEvents(events: NDKEvent[]): NostrEvent[] {
  const out: NostrEvent[] = [];
  for (const event of events) {
    const mapped = toNostrEvent(event);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Type guard for filtering out nulls produced by `parse*` functions. */
export function notNull<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Exact union of event lists, deduped by id (later sources win on a collision, which never matters for
 * immutable kind-1111/7 events). O(n) time, O(n) space via a Map. Used to merge the SSR snapshot with
 * the live subscription so the feed is a monotonic union and never shrinks when one relay returns a
 * partial set. A Map (not a Bloom filter) is the right tool here: dedup is correctness-critical, and a
 * Bloom filter's false positives would silently DROP real ideas. Bloom fits negative caches where a
 * false positive is harmless (e.g. the indexer skipping a redundant write), not a user-facing feed.
 */
export function dedupeById(...lists: NostrEvent[][]): NostrEvent[] {
  const byId = new Map<string, NostrEvent>();
  for (const list of lists) for (const event of list) byId.set(event.id, event);
  return [...byId.values()];
}
