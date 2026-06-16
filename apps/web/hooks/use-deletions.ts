"use client";

import { useMemo } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { KIND, deletedEventIds, parseDelete, type NostrEvent } from "@voxboard/protocol";
import { dedupeById, ndkFilter, notNull, toNostrEvents } from "@/lib/nostr/event";

const EMPTY: Set<string> = new Set();
const NO_SEED: NostrEvent[] = [];

/**
 * The ids among `candidates` that their own author has retracted (NIP-09 kind 5). Subscribes to
 * deletions referencing the candidate ids and applies the same-author rule via deletedEventIds, so a
 * deleted idea / reply / reaction stays hidden across reloads even on relays that still serve it.
 * Returns a stable empty set when there are no deletions (the common case) to avoid needless re-renders.
 *
 * `seed` is an optional SSR snapshot of the relevant kind-5 deletions, unioned with the live sub: NDK
 * can momentarily return an empty `#e` set on a client-nav remount, which would otherwise un-apply a
 * retraction and let a deleted idea/reply/vote flash back. Seeding keeps the retraction sticky.
 */
export function useDeletedIds(candidates: NostrEvent[], seed: NostrEvent[] = NO_SEED): Set<string> {
  const ids = useMemo(() => candidates.map((c) => c.id), [candidates]);
  const key = ids.join(",");

  const sub = useSubscribe(
    ids.length > 0 ? [ndkFilter({ kinds: [KIND.Delete], "#e": ids })] : false,
    {},
    [key],
  );

  return useMemo(() => {
    const deletions = dedupeById(seed, toNostrEvents(sub.events)).map(parseDelete).filter(notNull);
    if (deletions.length === 0) return EMPTY;
    return deletedEventIds(deletions, candidates);
  }, [sub.events, candidates, seed]);
}
