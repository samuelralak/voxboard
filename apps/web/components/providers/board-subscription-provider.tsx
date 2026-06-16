"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import {
  KIND,
  deriveBoardView,
  type Board,
  type BoardView,
  type NostrEvent,
} from "@voxboard/protocol";
import { dedupeById, ndkFilter, toNostrEvents } from "@/lib/nostr/event";

/**
 * The single owner of a board's relay traffic. Every board surface (the feed on /b, the thread + votes
 * on /d) reads its derived view from here instead of opening its own overlapping subscriptions, so:
 *   - the read-time aggregate is computed ONCE by the shared, pure `deriveBoardView` (the same function
 *     the indexer projects `deriveBoardStats` from) — client and indexer can never disagree;
 *   - the duplicate `#A` / per-hook deletion subscriptions collapse into one set;
 *   - the feed and the idea detail are guaranteed consistent (same `view`).
 *
 * Zaps (async LNURL) and Web-of-Trust (viewer-specific) are NOT in `deriveBoardView`; they stay as thin
 * client-side overlays in the consumers.
 */

// Make the load-bearing NDK defaults EXPLICIT so a future edit can't silently flip them: react's
// `.d.ts` documents `cacheUsage: ONLY_CACHE` (that's useObserver), and ONLY_CACHE here would stop the
// board from ever hitting relays.
const SUB_OPTS = { closeOnEose: false, cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST } as const;
const EMPTY: NostrEvent[] = [];

export interface BoardSubscription {
  /** the authoritative board (kind 34550) for this scope */
  board: Board | null;
  /** the full read-time view: ideas (with byPubkey tallies), replies, moderation sets, locks, pins, pending */
  view: BoardView;
  /** feed EOSE — a skeleton hint only; SSR-seeded data renders before this and never waits on it */
  eose: boolean;
}

const Ctx = createContext<BoardSubscription | null>(null);

export function useBoardSubscription(): BoardSubscription {
  const value = useContext(Ctx);
  if (!value) throw new Error("useBoardSubscription must be used within a BoardSubscriptionProvider");
  return value;
}

export function BoardSubscriptionProvider({
  board,
  coordinate,
  initialIdeas = EMPTY,
  initialReplies = EMPTY,
  initialModeration = EMPTY,
  initialVotes = EMPTY,
  initialDeletions = EMPTY,
  children,
}: {
  board: Board | null;
  /** coordinate fallback when `board` (the kind-34550) hasn't resolved — the idea route always knows its
   *  coordinate from the idea, so the thread/votes still load (moderation just stays empty until board) */
  coordinate?: string;
  /** raw kind-1111 idea events (SSR seed) */
  initialIdeas?: NostrEvent[];
  /** raw kind-1111 reply events (SSR seed) */
  initialReplies?: NostrEvent[];
  /** raw kind-1985 labels + kind-4550 approvals (SSR seed) */
  initialModeration?: NostrEvent[];
  /** raw kind-7 reactions (SSR seed) */
  initialVotes?: NostrEvent[];
  /** raw kind-5 deletions (SSR seed) */
  initialDeletions?: NostrEvent[];
  children: ReactNode;
}) {
  const coord = board?.coordinate ?? coordinate ?? null;

  // 1. feed: ideas + ALL replies, board-wide. [coord] is the whole filter content, so it is the dep key.
  const feed = useSubscribe(coord ? [ndkFilter({ kinds: [KIND.Comment], "#A": [coord] })] : false, SUB_OPTS, [coord]);
  const commentSeed = useMemo(() => dedupeById(initialIdeas, initialReplies), [initialIdeas, initialReplies]);
  const commentEvents = useMemo(() => dedupeById(commentSeed, toNostrEvents(feed.events)), [commentSeed, feed.events]);

  // 2. labels + approvals in ONE merged sub (mirrors the indexer's board filters). Seeded + applied on
  //    first paint by deriveBoardView; never EOSE-gated.
  const mod = useSubscribe(
    coord ? [ndkFilter({ kinds: [KIND.Label, KIND.PostApproval], "#a": [coord] })] : false,
    SUB_OPTS,
    [coord],
  );
  const modEvents = useMemo(() => dedupeById(initialModeration, toNostrEvents(mod.events)), [initialModeration, mod.events]);

  // 3. reactions (votes) for the whole board. Phase 9: Voxboard votes carry the board `A` tag, so this is
  //    a STABLE coordinate-keyed sub — no growing `#e` id-set, no closure-capture hazard (the old
  //    constraint that forced the id-set into the dep array). The SSR seed (initialVotes, queried
  //    server-side by `#e`) covers the COMPLETE set (historical + cross-client + Voxboard) at first paint
  //    AND on every reload. The live `#A` sub then carries new VOXBOARD votes (only Voxboard emits `A`).
  //    ACCEPTED TRADE-OFF: a vote cast from another client (Amethyst, etc.) arrives LIVE without `A`, so
  //    it is not seen until the next reload re-runs the `#e` seed; tallies stay correct, just stale-live.
  //    (The feed seed covers IDEA votes; reply votes are seeded only on /d, fine since the feed doesn't
  //    vote replies.)
  const reactions = useSubscribe(
    coord ? [ndkFilter({ kinds: [KIND.Reaction], "#A": [coord] })] : false,
    SUB_OPTS,
    [coord],
  );
  const reactionEvents = useMemo(() => dedupeById(initialVotes, toNostrEvents(reactions.events)), [initialVotes, reactions.events]);

  // 4. deletions (NIP-09 retractions) for the whole board. Phase 9: a Voxboard retraction of board content
  //    carries the board `A` tag (idea/reply deletes + vote retractions), so this is a stable coordinate
  //    key too. CRITICAL: the SSR seed (initialDeletions) seeds retractions by `#e` over the content ids
  //    AND the vote ids (server.ts third pass) — so a cross-client / pre-Phase-9 vote retraction, which
  //    lacks `A` and is invisible to this live sub, still applies at first paint + reload; without that
  //    seed the retracted vote would count forever. Same accepted live trade-off as votes (an untagged
  //    retraction arriving LIVE shows only after the next reload). deriveBoardView consumes the kind-5s.
  const deletions = useSubscribe(
    coord ? [ndkFilter({ kinds: [KIND.Delete], "#A": [coord] })] : false,
    SUB_OPTS,
    [coord],
  );
  const deletionEvents = useMemo(() => dedupeById(initialDeletions, toNostrEvents(deletions.events)), [initialDeletions, deletions.events]);

  // One pure derivation over the whole unioned pool. The board's own kind-34550 is included so
  // deriveBoardView resolves moderation against the right board.
  const view = useMemo(
    () => deriveBoardView([...commentEvents, ...modEvents, ...reactionEvents, ...deletionEvents, ...(board ? [board.raw] : [])]),
    [commentEvents, modEvents, reactionEvents, deletionEvents, board],
  );

  const value = useMemo<BoardSubscription>(() => ({ board, view, eose: feed.eose }), [board, view, feed.eose]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
