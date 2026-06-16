import { HugeiconsIcon } from "@hugeicons/react";
import { Comment01Icon } from "@hugeicons/core-free-icons";

/** Loading placeholder that mirrors the feed-row geometry (vote pill + title + lines + meta). */
export function FeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b border-border px-2 py-4">
          <div className="h-20 w-10 shrink-0 animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
            <div className="h-3 w-28 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Empty state: a quiet invitation, not a shrug. */
export function FeedEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-card">
        <HugeiconsIcon icon={Comment01Icon} size={22} strokeWidth={1.5} />
      </span>
      <p className="font-display text-lg text-ink">No ideas yet</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        Be the first to share feedback. What you post is signed by your key and carried on Nostr
        relays, yours to keep, anywhere.
      </p>
    </div>
  );
}
