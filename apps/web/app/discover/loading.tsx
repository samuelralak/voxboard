import { Shell } from "@/components/layout/shell";

/**
 * Loading skeleton for the force-dynamic discover fetch. Mirrors the header + board-row geometry so the
 * relay round-trip feels instant and calm instead of popping in. Pulse is gated behind motion-safe.
 */
export default function DiscoverLoading() {
  return (
    <Shell className="py-10 sm:py-16" aria-busy>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between" aria-hidden>
        <div className="max-w-2xl">
          <div className="h-3 w-16 rounded bg-surface-2 motion-safe:animate-pulse" />
          <div className="mt-3 h-10 w-64 max-w-full rounded bg-surface-2 motion-safe:animate-pulse" />
          <div className="mt-4 h-4 w-full max-w-xl rounded bg-surface-2 motion-safe:animate-pulse" />
        </div>
        <div className="h-9 w-32 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse sm:mt-1" />
      </div>

      <div className="mt-10" aria-hidden>
        <div className="h-3 w-20 rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="mt-3 divide-y divide-border border-y border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4">
              <div className="size-10 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-surface-2 motion-safe:animate-pulse" />
                <div className="h-3 w-64 max-w-full rounded bg-surface-2 motion-safe:animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading boards…</span>
    </Shell>
  );
}
