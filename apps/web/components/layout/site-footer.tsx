import { Shell } from "./shell";

/**
 * App footer. Static Server Component, rendered through <Shell> so its content edges align with the
 * page and header. Small monogram + provenance, echoing the original's restraint in Voxboard tokens.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Shell className="flex items-center justify-between py-6 text-sm text-muted">
        <span className="font-display text-base font-semibold tracking-tight text-ink">Voxboard</span>
        <span>
          Feedback boards on{" "}
          <a
            href="https://github.com/nostr-protocol/nips"
            className="text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
          >
            Nostr
          </a>
        </span>
      </Shell>
    </footer>
  );
}
