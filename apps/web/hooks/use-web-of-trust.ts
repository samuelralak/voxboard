"use client";

import { useCallback, useMemo } from "react";
import { useFollows } from "@nostr-dev-kit/react";
import type { VoteDirection } from "@voxboard/protocol";
import { useAuth } from "./use-auth";

export interface WebOfTrust {
  /** the signed-in viewer directly follows this pubkey (NIP-02 depth-1, "in your network") */
  isTrusted: (pubkey: string) => boolean;
  /** how many accounts the viewer follows */
  size: number;
  /** logged in AND has a (non-empty) follow list, so trust signals are meaningful */
  ready: boolean;
}

/**
 * Viewer-specific Web-of-Trust: the signed-in user's direct NIP-02 follow set (depth-1), read from the
 * NDK session (loaded on login, not the event cache — so it's reliable). Purely client-side and
 * per-viewer; it NEVER touches the shared deterministic aggregate (deriveBoardStats), which the indexer
 * and every client must agree on. Powers an "in your network" author signal and a secondary
 * "what your network thinks" vote read, shown ALONGSIDE the raw score, never replacing it.
 */
export function useWebOfTrust(): WebOfTrust {
  const { pubkey } = useAuth();
  const follows = useFollows();
  // Exclude the viewer themselves: a (legal) self-follow must not show an "in your network" badge on
  // your own content, nor self-count your own upvote in the trusted tally.
  const isTrusted = useCallback((pk: string) => pk !== pubkey && follows.has(pk), [follows, pubkey]);
  return useMemo(
    () => ({ isTrusted, size: follows.size, ready: Boolean(pubkey) && follows.size > 0 }),
    [isTrusted, follows.size, pubkey],
  );
}

/**
 * The net score and upvote count contributed by voters the viewer follows — the anti-sybil "trusted"
 * read over a vote tally's per-pubkey directions.
 */
export function trustedVotes(
  byPubkey: Map<string, VoteDirection>,
  isTrusted: (pubkey: string) => boolean,
): { score: number; upvotes: number } {
  let score = 0;
  let upvotes = 0;
  for (const [pubkey, direction] of byPubkey) {
    if (!isTrusted(pubkey)) continue;
    if (direction === "up") {
      score += 1;
      upvotes += 1;
    } else {
      score -= 1;
    }
  }
  return { score, upvotes };
}
