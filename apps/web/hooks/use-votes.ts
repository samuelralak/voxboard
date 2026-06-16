"use client";

import { useMemo } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { KIND, parseVote, type NostrEvent, type VoteDirection } from "@voxboard/protocol";
import { useDeletedIds } from "./use-deletions";
import { ndkFilter, notNull, toNostrEvents } from "@/lib/nostr/event";

/**
 * Displayed vote tallies now come from the shared BoardSubscriptionProvider's `deriveBoardView`
 * (use-board-data / idea-view read `view.tallies`), so there is no longer a separate per-target vote
 * subscription. This file keeps only `useMyReactions` — the viewer's OWN reactions, which voting still
 * needs for the retraction event id and the cast() baseline (see use-voting.ts).
 */

/** One pubkey's own reaction per target: the deduped (latest) direction plus the reaction event id. */
export interface MyReaction {
  /** the reaction event's own id (needed to retract it with NIP-09) */
  id: string;
  direction: VoteDirection;
  createdAt: number;
}

/** A superseded own-reaction (an older reaction on a target where a newer one wins) and its target. */
export interface StaleReaction {
  id: string;
  targetId: string;
}

export interface MyReactions {
  /** the live (latest) reaction per target */
  byTarget: Map<string, MyReaction>;
  /** older reactions the latest superseded; the caller can retract these (NIP-09) to avoid orphans */
  stale: StaleReaction[];
}

/**
 * The current user's own reactions for a set of targets. Keeps each reaction's event id so a vote can be
 * toggled off by deleting it (NIP-09), and surfaces superseded reactions (`stale`) so a switch/toggle can
 * clean up the loser even when it only became known after the action. Scoped to `authors: [pubkey]` and
 * outbox-routed, so it can see a reaction written only to an off-default write relay (which the shared
 * all-authors tally cannot) — that is exactly why it stays a separate, viewer-scoped subscription.
 */
export function useMyReactions(ids: string[], pubkey: string | null): MyReactions {
  const enabled = ids.length > 0 && Boolean(pubkey);
  const sub = useSubscribe(
    enabled ? [ndkFilter({ kinds: [KIND.Reaction], "#e": ids, authors: [pubkey as string] })] : false,
    {},
    [ids.join(","), pubkey],
  );
  const votes = useMemo(() => toNostrEvents(sub.events).map(parseVote).filter(notNull), [sub.events]);
  const candidates = useMemo<NostrEvent[]>(() => votes.map((v) => v.raw), [votes]);
  const hidden = useDeletedIds(candidates);
  return useMemo<MyReactions>(() => {
    const byTarget = new Map<string, MyReaction>();
    const stale: StaleReaction[] = [];
    for (const v of votes) {
      if (hidden.has(v.id)) continue; // already retracted: neither live nor stale
      const prev = byTarget.get(v.targetId);
      if (!prev) {
        byTarget.set(v.targetId, { id: v.id, direction: v.direction, createdAt: v.createdAt });
        continue;
      }
      // latest-per-target, lowest id breaks a created_at tie (matches tallyVotes)
      const vWins = v.createdAt > prev.createdAt || (v.createdAt === prev.createdAt && v.id < prev.id);
      if (vWins) {
        stale.push({ id: prev.id, targetId: v.targetId });
        byTarget.set(v.targetId, { id: v.id, direction: v.direction, createdAt: v.createdAt });
      } else {
        stale.push({ id: v.id, targetId: v.targetId });
      }
    }
    return { byTarget, stale };
  }, [votes, hidden]);
}
