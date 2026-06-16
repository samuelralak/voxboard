"use client";

import { useMemo } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { KIND, parseBoard, parseCommunityCoordinate, type Board } from "@voxboard/protocol";
import { ndkFilter, toNostrEvents } from "@/lib/nostr/event";

/**
 * Resolve a board (kind 34550) from its coordinate `34550:<owner>:<slug>`.
 * Returns `undefined` while loading, `null` if not found.
 *
 * Uses a SUBSCRIPTION (not fetchEvent(naddr)): a subscription reliably hits the configured relays,
 * whereas fetchEvent(naddr) routes via the outbox model to the author's NIP-65 relays and silently
 * misses boards whose owner has no relay list. We collapse to the latest replaceable version (NIP-01:
 * highest created_at, lowest id breaks a tie). Subscribing (vs. fetchEvent) also stays clear of NDK's
 * fetch-events-usage guardrail.
 *
 * `seed` is an optional SSR-resolved board. The board route already passes the board down as a prop; the
 * idea route can't (it resolves the idea first), so it seeds here instead. Without the seed this sub can
 * return empty on a client-nav remount, leaving the board null and HIDING the reply form. The seed makes
 * the board present from first paint and persists if the live sub momentarily comes back empty.
 */
export function useBoard(coordinate: string | null, seed?: Board | null): Board | null | undefined {
  const ref = coordinate ? parseCommunityCoordinate(coordinate) : null;
  const sub = useSubscribe(
    ref ? [ndkFilter({ kinds: [KIND.Community], authors: [ref.pubkey], "#d": [ref.slug] })] : false,
    {},
    [coordinate],
  );
  return useMemo(() => {
    if (!ref) return null;
    const events = toNostrEvents(sub.events);
    // No live event yet: fall back to the SSR seed (if any), else loading (undefined) / not-found (null).
    if (events.length === 0) return seed ?? (sub.eose ? null : undefined);
    const latest = events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0]!;
    return parseBoard(latest) ?? seed ?? null;
  }, [sub.events, sub.eose, ref, seed]);
}
