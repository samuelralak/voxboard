import Link from "next/link";
import { Shell } from "@/components/layout/shell";

export default function NotFound() {
  return (
    <Shell className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">404</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        This page does not exist or has moved. It may have been a board or idea that is not on the
        relays we checked.
      </p>
      <Link
        href="/discover"
        className="mt-2 inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Browse boards
      </Link>
    </Shell>
  );
}
