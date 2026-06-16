"use client";

import { useEffect } from "react";
import { Shell } from "@/components/layout/shell";

/**
 * Route-level error boundary. Any render or data throw inside a page segment degrades to this fallback
 * instead of a blank screen; the root layout (header/footer) stays mounted and `reset` retries the
 * segment. A crafted relay event (e.g. an out-of-range timestamp) must never take down a whole route.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Shell className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">Error</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        We hit a snag rendering this page. It may be a malformed event on the relays we checked.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Try again
      </button>
    </Shell>
  );
}
