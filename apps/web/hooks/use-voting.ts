"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KIND, buildDelete, buildVote, now, type VoteDirection, type VoteTally, type VoteTarget } from "@voxboard/protocol";
import { useAuth } from "./use-auth";
import { usePublish } from "./use-publish";
import { useMyReactions } from "./use-votes";
import { useLoginGate } from "@/components/auth/login-gate";

const VALUE: Record<VoteDirection, number> = { up: 1, down: -1 };
function scoreOf(direction: VoteDirection | null): number {
  return direction ? VALUE[direction] : 0;
}

export interface Voting {
  /** the user's effective vote on a target (optimistic if a click is in flight, else relay truth) */
  myVote: (id: string) => VoteDirection | null;
  /** delta to add to the relay tally score so the user's own (optimistic) vote shows immediately */
  scoreDelta: (id: string) => number;
  isPending: (id: string) => boolean;
  /** Cast / change / retract a vote. Opens the login dialog if logged out. */
  cast: (target: VoteTarget, direction: VoteDirection) => void;
}

/**
 * Voting for a set of targets (ideas or replies). A NIP-25 reaction is append-only with no neutral
 * value, so:
 *   - clicking the direction you already hold retracts it (NIP-09 delete of your reaction),
 *   - clicking the opposite direction publishes the new reaction and retracts the old one.
 * The relay tally already counts your reaction once it round-trips, so the displayed score neutralizes
 * the relay's record of your vote (`scoreDelta`) and applies your optimistic intent instead, keeping
 * the number correct whether or not your reaction has propagated back yet.
 *
 * The DISPLAYED neutralization is read from the SAME VoteTally.byPubkey that produces the displayed
 * score (passed in via `tallies`), so the two move in one React commit and the score can never briefly
 * double-count your own vote (the +2-then-+1 flicker). The separate authored sub (`useMyReactions`,
 * authors:[me]) is kept only for the retraction event id and the cast() baseline, because it alone can
 * see a reaction written to an off-default write relay; its lag no longer affects the rendered number.
 */
/** A reaction this client published this session: enough to retract it before the relay echoes it back. */
interface OwnReaction {
  id: string;
  direction: VoteDirection;
  createdAt: number;
}

export function useVoting(ids: string[], tallies?: Map<string, VoteTally>): Voting {
  const { pubkey } = useAuth();
  const { requireLogin } = useLoginGate();
  const publish = usePublish();
  const mine = useMyReactions(ids, pubkey); // authored truth: direction + reaction event id, per target

  const [optimistic, setOptimistic] = useState<Map<string, VoteDirection | null>>(new Map());
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Reactions we've published this session, keyed by target. The relay subscription (`mine`) lags a
  // publish by a round-trip, so a quick second click must retract THIS, not the not-yet-echoed relay
  // copy, or the superseded reaction is orphaned (and a same-second created_at tie could flip the count).
  const published = useRef<Map<string, OwnReaction>>(new Map());
  const ownReaction = useCallback(
    (id: string): OwnReaction | undefined => published.current.get(id) ?? mine.byTarget.get(id),
    [mine],
  );

  // Retract superseded own-reactions once the subscription reveals them, but only on targets the user
  // acted on this session. This cleans up an orphan when a switch happened before the prior reaction
  // had loaded (so `existing` was unknown at cast time): the count is already correct via dedup, this
  // just removes the dangling reaction. Idempotent via `retracted`.
  const retracted = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of mine.stale) {
      if (retracted.current.has(s.id) || !optimistic.has(s.targetId)) continue;
      retracted.current.add(s.id);
      // Best-effort cleanup of a SUPERSEDED own-reaction. Intentionally un-scoped: `mine.stale` carries no
      // coordinate, so this kind-5 has no `A` tag and the live `#A` deletions sub won't catch it — but it
      // is harmless (latest-per-pubkey dedup already drops the superseded reaction from the score), and the
      // SSR vote-deletion seed reconciles the orphan on the next load.
      void publish(buildDelete({ ids: [s.id], kinds: [KIND.Reaction] })).catch(() => {});
    }
  }, [mine.stale, optimistic, publish]);

  // The viewer's own reaction as reported by the AUTHORED sub (authors:[me], outbox-routed). This is the
  // toggle/retraction source of truth: it can see a reaction written only to an off-default write relay,
  // which the all-authors tally cannot. Used for the cast() baseline and (via ownReaction) retraction.
  const relayMineAuthored = useCallback(
    (id: string): VoteDirection | null => mine.byTarget.get(id)?.direction ?? null,
    [mine],
  );
  // The viewer's own reaction AS COUNTED IN THE DISPLAYED TALLY: read from the same VoteTally.byPubkey
  // that produces tally.score, so the neutralization moves in the SAME commit as the score (no +2 frame).
  // Falls back to the authored sub only when no shared tally is supplied for this target.
  const displayedRelay = useCallback(
    (id: string): VoteDirection | null => {
      if (!pubkey) return null;
      const tally = tallies?.get(id);
      return tally ? tally.byPubkey.get(pubkey) ?? null : relayMineAuthored(id);
    },
    [tallies, pubkey, relayMineAuthored],
  );
  const myVote = useCallback(
    (id: string): VoteDirection | null => (optimistic.has(id) ? (optimistic.get(id) ?? null) : displayedRelay(id)),
    [optimistic, displayedRelay],
  );
  const scoreDelta = useCallback(
    (id: string) => scoreOf(myVote(id)) - scoreOf(displayedRelay(id)),
    [myVote, displayedRelay],
  );
  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  const cast = useCallback(
    (target: VoteTarget, direction: VoteDirection) => {
      requireLogin(() => {
        const id = target.id;
        const current = optimistic.has(id) ? (optimistic.get(id) ?? null) : relayMineAuthored(id);
        const next: VoteDirection | null = current === direction ? null : direction;
        const existing = ownReaction(id); // the reaction to retract (our just-published one wins over relay)

        setOptimistic((m) => new Map(m).set(id, next));
        setPending((s) => new Set(s).add(id));

        void (async () => {
          try {
            if (next === null) {
              if (existing) {
                retracted.current.add(existing.id); // claim it so the cleanup effect won't re-delete
                await publish(buildDelete({ ids: [existing.id], kinds: [KIND.Reaction], scope: target.coordinate }));
                published.current.delete(id);
              }
            } else {
              // strictly newer than any prior reaction for this target, so latest-per-pubkey dedup can
              // never pick the older one on a same-second collision
              const createdAt = Math.max(now(), (existing?.createdAt ?? 0) + 1);
              const event = await publish(buildVote({ target, direction: next, createdAt }));
              published.current.set(id, { id: event.id, direction: next, createdAt });
              // best-effort retract of the superseded opposite reaction (dedup already favors the newer one)
              if (existing && existing.direction !== next) {
                retracted.current.add(existing.id); // claim it so the cleanup effect won't re-delete
                try {
                  await publish(buildDelete({ ids: [existing.id], kinds: [KIND.Reaction], scope: target.coordinate }));
                } catch {
                  // leave the orphan; the newer reaction still wins the tally
                }
              }
            }
          } catch {
            // the primary action failed: roll back to the last-known-good displayed vote (not blindly to relay)
            setOptimistic((m) => new Map(m).set(id, current));
          } finally {
            setPending((s) => {
              const n = new Set(s);
              n.delete(id);
              return n;
            });
          }
        })();
      });
    },
    [requireLogin, optimistic, relayMineAuthored, ownReaction, publish],
  );

  return useMemo(() => ({ myVote, scoreDelta, isPending, cast }), [myVote, scoreDelta, isPending, cast]);
}
