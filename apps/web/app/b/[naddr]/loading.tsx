import { Shell } from "@/components/layout/shell";
import { FeedSkeleton } from "@/components/board/feed-states";

/**
 * Route-level loading UI for the force-dynamic board page. `fetchBoardSnapshot` is a relay round-trip,
 * so without this boundary the App Router keeps the PREVIOUS screen mounted until the server component
 * resolves, which reads as a frozen click. This swaps in instantly on navigation and mirrors the real
 * masthead + tabs + toolbar + feed-row geometry so the transition is calm, not a pop. Pulse is gated
 * behind motion-safe.
 */
export default function BoardLoading() {
  return (
    <Shell width="wide" aria-busy>
      {/* masthead: identity row (square tile + name + meta) with actions, then a full-width description */}
      <header className="py-8" aria-hidden>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="size-12 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            <div className="min-w-0 space-y-2">
              <div className="h-7 w-52 max-w-full rounded bg-surface-2 motion-safe:animate-pulse" />
              <div className="h-3 w-40 rounded bg-surface-2 motion-safe:animate-pulse" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="size-9 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            <div className="size-9 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-9 w-24 rounded-md bg-surface-2 motion-safe:animate-pulse" />
          </div>
        </div>
        <div className="mt-5 h-4 w-full max-w-2xl rounded bg-surface-2 motion-safe:animate-pulse" />
      </header>

      {/* feed / roadmap tabs */}
      <div className="mt-6 flex gap-3 border-b border-border pb-2" aria-hidden>
        <div className="h-5 w-12 rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-5 w-16 rounded bg-surface-2 motion-safe:animate-pulse" />
      </div>

      {/* sort / filter toolbar */}
      <div className="flex items-center gap-2 py-4" aria-hidden>
        <div className="h-8 w-16 rounded-md bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-8 w-20 rounded-md bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-8 w-20 rounded-md bg-surface-2 motion-safe:animate-pulse" />
      </div>

      <FeedSkeleton />
      <span className="sr-only">Loading board…</span>
    </Shell>
  );
}
