import { Shell } from "@/components/layout/shell";

/**
 * Route-level loading UI for the force-dynamic idea page. `fetchIdeaThreadSnapshot` is a relay round-trip,
 * so without this boundary the App Router holds the previous screen until it resolves, which reads as a
 * frozen click. Mirrors the vote-ledger column + idea-detail header + body + a couple of reply rows so
 * the swap is instant and calm. Pulse is gated behind motion-safe.
 */
export default function IdeaLoading() {
  return (
    <Shell aria-busy>
      {/* idea detail: vote ledger column + title/meta/body */}
      <article className="flex gap-3 py-6" aria-hidden>
        <div className="h-20 w-10 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="h-7 w-2/3 rounded bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-8 w-20 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse" />
          </div>
          {/* meta: avatar + name + time */}
          <div className="mt-3 flex items-center gap-2">
            <div className="size-6 rounded-full bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-3 w-28 rounded bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-3 w-16 rounded bg-surface-2 motion-safe:animate-pulse" />
          </div>
          {/* body */}
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full rounded bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-4 w-full rounded bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-4 w-4/5 rounded bg-surface-2 motion-safe:animate-pulse" />
          </div>
        </div>
      </article>

      {/* reply composer */}
      <div className="h-24 w-full rounded-md border border-border bg-surface-2/40 motion-safe:animate-pulse" aria-hidden />

      {/* a couple of reply rows */}
      <div className="mt-6 space-y-5" aria-hidden>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="size-6 shrink-0 rounded-full bg-surface-2 motion-safe:animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-surface-2 motion-safe:animate-pulse" />
              <div className="h-4 w-full rounded bg-surface-2 motion-safe:animate-pulse" />
              <div className="h-4 w-3/4 rounded bg-surface-2 motion-safe:animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading idea…</span>
    </Shell>
  );
}
