import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Github01Icon, FavouriteIcon } from "@hugeicons/core-free-icons";
import { Shell } from "./shell";

const REPO_URL = "https://github.com/samuelralak/voxboard";
const NIPS_URL = "https://github.com/nostr-protocol/nips";

/**
 * App footer. Static Server Component that bookends the header: same <Shell> edges, and links styled like
 * the header nav (h-9 pills, color-only hover, accent focus ring) so the chrome feels of a piece. The
 * left half carries identity (wordmark + a one-line provenance); the right half carries the two actions.
 * Donate wears the sats hue, so support reads apart from the source link.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Shell className="flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <span className="font-display text-base font-semibold tracking-tight text-ink">Voxboard</span>
          <p className="mt-1 text-sm text-muted">
            Open feedback boards on{" "}
            <a
              href={NIPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-border underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              Nostr
            </a>
          </p>
        </div>

        {/* Pull the nav left by the link padding so the first item aligns to the content edge on mobile;
            on sm+ it sits at the right edge like the header nav. */}
        <nav className="-ml-3 flex items-center gap-0.5 sm:ml-0">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <HugeiconsIcon icon={Github01Icon} size={16} strokeWidth={2} />
            GitHub
          </a>
          <Link
            href="/donate"
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <HugeiconsIcon icon={FavouriteIcon} size={16} strokeWidth={2} className="text-zap" />
            Donate
          </Link>
        </nav>
      </Shell>
    </footer>
  );
}
