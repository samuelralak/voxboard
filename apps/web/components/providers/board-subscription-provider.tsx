"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import {
  KIND,
  deriveBoardView,
  partitionBoardEvents,
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

/**
 * Debounce a value. Used on the `#e` id-set keys so a hydration burst (ideas streaming in one by one)
 * coalesces into ONE re-subscribe after a quiet period instead of N. The first transition (empty → some
 * ids) is NOT delayed — that is driven by useSubscribe's own `!!filters` dep, so reactions/deletions
 * still open immediately; only subsequent GROWTH of the id-window is debounced. Lossless: NDK's
 * filterExistingEvents preserves already-received events across the re-subscribe, and the SSR seed covers
 * first paint regardless.
 */
function useDebounced<T>(value: T, ms: number, maxWait = ms * 4): T {
  const [debounced, setDebounced] = useState(value);
  // Trailing debounce WITH a max-wait cap: the timer resets on each change (coalescing a hydration burst),
  // but it can never be starved past `maxWait` by a sustained sub-`ms` stream — so a busy/adversarial relay
  // can't indefinitely defer the `#e` re-subscribe and silently miss reactions/deletions of new content.
  const lastApplied = useRef(0);
  useEffect(() => {
    const delay = Math.min(ms, Math.max(0, maxWait - (Date.now() - lastApplied.current)));
    const timer = setTimeout(() => {
      lastApplied.current = Date.now();
      setDebounced(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, ms, maxWait]);
  return debounced;
}

const ID_SET_DEBOUNCE_MS = 250;

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

  // Content ids that key the `#e` subs. CONSTRAINT: these MUST stay in the dependency array — react's
  // useSubscribe captures the filter by closure and re-subscribes only when deps change, so keying on
  // [coord] would freeze a growing `#e` window and silently miss reactions/deletions of later arrivals.
  // DO NOT "simplify" these to `#A`: Voxboard votes/deletions now also carry an additive `A` (coordinate)
  // tag, but a coordinate-keyed sub matches ONLY Voxboard-tagged events and would silently miss votes +
  // retractions from any other Nostr client (and pre-`A` events) until a reload — a real cross-client
  // regression (adversarial review wwhmn2s30). The `A` tag is additive metadata for a future server-side
  // indexer, which the canonical design (INDEXER.md) also aggregates by `#e`, never `#A`.
  const parsed = useMemo(() => partitionBoardEvents(commentEvents), [commentEvents]);
  const commentIds = useMemo(
    () => [...parsed.ideas.map((i) => i.id), ...parsed.replies.map((r) => r.id)],
    [parsed],
  );
  // Debounced so a hydration burst coalesces into one re-subscribe; the filter still uses the CURRENT
  // commentIds (useSubscribe captures filters at effect-run time), and the empty→some transition still
  // subscribes immediately via useSubscribe's own `!!filters` dep.
  const commentIdKey = useDebounced(commentIds.join(","), ID_SET_DEBOUNCE_MS);

  // 3. reactions for every idea AND reply (the idea page needs reply tallies too).
  const reactions = useSubscribe(
    commentIds.length > 0 ? [ndkFilter({ kinds: [KIND.Reaction], "#e": commentIds })] : false,
    SUB_OPTS,
    [commentIdKey],
  );
  const reactionEvents = useMemo(() => dedupeById(initialVotes, toNostrEvents(reactions.events)), [initialVotes, reactions.events]);

  // 4. deletions over the FULL candidate union (ideas+replies+labels+approvals+reactions) so a retraction
  //    of ANY of them is honored on the first derive pass (deriveBoardView consumes the kind-5 events).
  //    Scope: `#e` (event id) only. The board's own kind-34550 is replace-only (latest-version-wins via
  //    the `board` prop / useBoard sub), and `a`-coordinate (NIP-09) deletions of the board/labels are
  //    out of scope (no
  //    in-app path emits them); add an `#a` deletions sub here if cross-client board retraction is needed.
  const deletionIds = useMemo(
    () => [...commentIds, ...modEvents.map((e) => e.id), ...reactionEvents.map((e) => e.id)],
    [commentIds, modEvents, reactionEvents],
  );
  const deletionKey = useDebounced(deletionIds.join(","), ID_SET_DEBOUNCE_MS);
  const deletions = useSubscribe(
    deletionIds.length > 0 ? [ndkFilter({ kinds: [KIND.Delete], "#e": deletionIds })] : false,
    SUB_OPTS,
    [deletionKey],
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
