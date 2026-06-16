import { Shell } from "@/components/layout/shell";

/**
 * Route-level loading UI for the force-dynamic org/profile page (`fetchOrgBoards` is a relay round-trip).
 * Without this boundary the App Router holds the previous screen until the fetch resolves. Mirrors the
 * profile header + board-list-row geometry. Pulse is gated behind motion-safe.
 */
export default function OrgLoading() {
  return (
    <Shell className="py-8" aria-busy>
      <header className="flex items-center gap-4 border-b border-border pb-6" aria-hidden>
        <div className="size-10 shrink-0 rounded-full bg-surface-2 motion-safe:animate-pulse" />
        <div className="min-w-0 space-y-2">
          <div className="h-7 w-44 max-w-full rounded bg-surface-2 motion-safe:animate-pulse" />
          <div className="h-3 w-32 rounded bg-surface-2 motion-safe:animate-pulse" />
        </div>
      </header>

      <div className="mt-6 divide-y divide-border border-b border-border" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-4">
            <div className="size-10 shrink-0 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-40 rounded bg-surface-2 motion-safe:animate-pulse" />
              <div className="h-3 w-64 max-w-full rounded bg-surface-2 motion-safe:animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading profile…</span>
    </Shell>
  );
}
