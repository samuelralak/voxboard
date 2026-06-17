"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ideaNevent, type Board } from "@voxboard/protocol";
import { useBoardData, type IdeaRow } from "@/hooks/use-board-data";
import { useVoting } from "@/hooks/use-voting";
import { useAuth } from "@/hooks/use-auth";
import { useModeration } from "@/hooks/use-moderation";
import { useLoginGate } from "@/components/auth/login-gate";
import { openDialog } from "@/lib/dialog";
import { ClientOnly } from "@/components/util/client-only";
import { LazyRow } from "@/components/util/lazy-row";
import { BoardHeader } from "./board-header";
import { BoardDialog } from "./board-dialog";
import { PendingApprovals } from "./pending-approvals";
import { ComposeIdeaDialog } from "./compose-idea-dialog";
import { FeedToolbar, type SortKey } from "./feed-toolbar";
import { FeedRowContainer } from "./feed-row-container";
import { FeedEmpty, FeedSkeleton } from "./feed-states";
import { Roadmap } from "./roadmap";

const VIEWS = [
  { key: "feed", label: "Feed" },
  { key: "roadmap", label: "Roadmap" },
] as const;
type View = (typeof VIEWS)[number]["key"];

// Rows before this index render eagerly so SSR + first paint carry real content (SEO, unfurls, no-JS)
// and the above-the-fold feed is immediate; only the long tail lazy-mounts, so a large board does not
// open a kind-0 profile sub + NIP-05 verify + WoT check for every idea on first paint.
const EAGER_ROWS = 12;

/**
 * The live board experience: header + sort/filter + the feed. The board's relay traffic is owned by the
 * BoardSubscriptionProvider (mounted by BoardView); this reads the derived view via useBoardData().
 */
export function BoardFeed({ board, attested = false }: { board: Board; attested?: boolean }) {
  const { rows, eose, pending } = useBoardData();
  const moderation = useModeration(board);
  const [sort, setSort] = useState<SortKey>("top");
  const [category, setCategory] = useState<string | null>(null);
  const [view, setView] = useState<View>("feed");

  const ideaIds = useMemo(() => rows.map((row) => row.idea.id), [rows]);
  // Feed the per-idea tallies into voting so the displayed "my vote" neutralization is read from the
  // SAME tally that produces each row's score (no transient double-count). Keyed off rows so it updates
  // in lockstep with the scores it neutralizes.
  const tallies = useMemo(() => new Map(rows.map((row) => [row.idea.id, row.tally])), [rows]);
  const voting = useVoting(ideaIds, tallies);

  const { requireLogin } = useLoginGate();
  const { pubkey } = useAuth();
  const composeId = useId();
  const editId = useId();
  const onNewIdea = () => requireLogin(() => openDialog(composeId));
  const canEdit = Boolean(pubkey) && pubkey === board.pubkey;

  const visible = useMemo(() => sortAndFilter(rows, sort, category), [rows, sort, category]);
  // The skeleton clears on EOSE, on the first row, OR after a max-wait — a default relay (e.g. a
  // profile-only relay) may never EOSE a kind-1111 filter, which would otherwise leave an EMPTY board
  // pulsing forever. Reset the ceiling per board so navigating to a different one starts fresh.
  const [maxWaited, setMaxWaited] = useState(false);
  useEffect(() => {
    setMaxWaited(false);
    const timer = setTimeout(() => setMaxWaited(true), 5000);
    return () => clearTimeout(timer);
  }, [board.coordinate]);
  const loading = rows.length === 0 && !eose && !maxWaited;

  return (
    <div>
      <BoardHeader
        board={board}
        ideaCount={rows.length}
        attested={attested}
        onNewIdea={onNewIdea}
        onCopyLink={() => {
          if (typeof window !== "undefined") void navigator.clipboard?.writeText(window.location.href);
        }}
        {...(canEdit ? { onEdit: () => openDialog(editId) } : {})}
      />
      <ClientOnly>
        <ComposeIdeaDialog dialogId={composeId} board={board} />
        {canEdit ? <BoardDialog dialogId={editId} board={board} /> : null}
      </ClientOnly>

      <PendingApprovals pending={pending} moderation={moderation} />

      <div className="mt-6 flex border-b border-border">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            aria-current={view === v.key ? "page" : undefined}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (view === v.key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")
            }
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "roadmap" ? (
        loading ? (
          <FeedSkeleton />
        ) : (
          <Roadmap rows={rows} />
        )
      ) : (
        <>
          <FeedToolbar
            sort={sort}
            onSort={setSort}
            categories={board.categories}
            activeCategory={category}
            onCategory={setCategory}
          />
          {loading ? (
            <FeedSkeleton />
          ) : visible.length === 0 ? (
            <FeedEmpty />
          ) : (
            <div data-feed>
              {visible.map((row, i) => (
                // Every row uses the SAME wrapper type so a score-driven re-sort across the eager
                // boundary preserves the row by key (no unmount/remount flicker); `eager` just controls
                // initial mount. The first EAGER_ROWS mount immediately (SSR/above-the-fold); the tail
                // lazy-mounts so a large board does not open a profile/NIP-05/WoT lookup for every idea.
                <LazyRow key={row.idea.id} eager={i < EAGER_ROWS}>
                  <FeedRowContainer
                    row={row}
                    href={`/d/${ideaNevent({ id: row.idea.id, author: row.idea.pubkey })}`}
                    voting={voting}
                  />
                </LazyRow>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function sortAndFilter(rows: IdeaRow[], sort: SortKey, category: string | null): IdeaRow[] {
  const filtered = category
    ? rows.filter((row) => row.idea.categories.includes(category))
    : rows;
  const sorted = [...filtered];
  // Pinned ideas always lead, then the chosen ordering.
  const pinnedFirst = (a: IdeaRow, b: IdeaRow) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);

  if (sort === "new") {
    sorted.sort((a, b) => pinnedFirst(a, b) || b.idea.createdAt - a.idea.createdAt);
  } else if (sort === "top") {
    sorted.sort((a, b) => pinnedFirst(a, b) || b.tally.score - a.tally.score || b.idea.createdAt - a.idea.createdAt);
  } else {
    // trending: score decayed by age (a simple gravity heuristic, age clamped so future stamps cannot NaN)
    const nowSeconds = Math.floor(Date.now() / 1000);
    const rank = (row: IdeaRow) =>
      (row.tally.score + 1) / Math.pow(Math.max(0, nowSeconds - row.idea.createdAt) / 3600 + 2, 1.5);
    sorted.sort((a, b) => pinnedFirst(a, b) || rank(b) - rank(a));
  }

  return sorted;
}
