import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Github01Icon, FavouriteIcon } from "@hugeicons/core-free-icons";
import { Shell } from "./shell";

const REPO_URL = "https://github.com/samuelralak/voxboard";

/**
 * App footer. Static Server Component, rendered through <Shell> so its content edges align with the
 * page and header. Brand on the left; on the right, the source link, a quiet Donate affordance (the
 * sats hue, so support stands apart from the utility links), and the Nostr provenance.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Shell className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6 text-sm text-muted">
        <span className="font-display text-base font-semibold tracking-tight text-ink">Voxboard</span>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Voxboard on GitHub"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-ink"
          >
            <HugeiconsIcon icon={Github01Icon} size={16} strokeWidth={2} />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <Link href="/donate" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink">
            <HugeiconsIcon icon={FavouriteIcon} size={16} strokeWidth={2} className="text-zap" />
            Donate
          </Link>
          <span>
            Feedback boards on{" "}
            <a
              href="https://github.com/nostr-protocol/nips"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              Nostr
            </a>
          </span>
        </nav>
      </Shell>
    </footer>
  );
}
