import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { buttonClasses } from "@/components/ui/button";
import { NewBoardButton } from "@/components/board/new-board-button";
import { RelayStatus } from "@/components/nostr/relay-status";

/**
 * Home. A single full-strength accent CTA (Browse boards) carries the eye; starting a board is the
 * quieter secondary action. The eyebrow is sans (mono is reserved for machine/identity data).
 */
export default function HomePage() {
  return (
    <Shell className="py-20 sm:py-28">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">
        Nostr feedback boards
      </p>
      <h1 className="mt-4 max-w-2xl font-display font-display-lg text-5xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
        Where your community shapes what you build.
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
        Open a board, collect ideas, vote on what matters, and watch them move from planned to
        shipped. Owned by your keys, carried by relays.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/discover" className={buttonClasses({ size: "lg" })}>
          Browse boards
        </Link>
        <NewBoardButton variant="outline" size="lg" label="Start a board" />
      </div>

      <div className="mt-12 flex items-center justify-between border-t border-border pt-6">
        <RelayStatus />
        <span className="font-mono text-xs text-muted">read path live</span>
      </div>
    </Shell>
  );
}
