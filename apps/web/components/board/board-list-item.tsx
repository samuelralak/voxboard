import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { Board } from "@voxboard/protocol";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { npubShort } from "@/lib/format";

/**
 * A board as a single-column list row (the editorial "printed list" aesthetic, matching the feed):
 * square board icon, name, one-line description, and a quiet meta line. Hairline-separated by the
 * parent, not boxed, so the page reads as one calm column instead of a ragged card grid.
 */
export function BoardListItem({
  board,
  href,
  ideaCount,
}: {
  board: Board;
  href: string;
  ideaCount?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <Avatar pubkey={board.pubkey} src={board.image?.url} alt={board.name} size="lg" shape="square" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-base font-semibold tracking-tight text-ink transition-colors group-hover:text-accent">
          {board.name}
        </h3>
        {board.description ? (
          <p className="mt-1 line-clamp-1 text-sm leading-relaxed text-muted">{board.description}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-mono tabular-nums">{npubShort(board.pubkey)}</span>
          {typeof ideaCount === "number" ? (
            <span className="font-mono tabular-nums">{ideaCount} ideas</span>
          ) : null}
          {board.categories.length > 0 ? <span className="text-border" aria-hidden>·</span> : null}
          {board.categories.slice(0, 3).map((category) => (
            <Chip key={category}>{category}</Chip>
          ))}
        </div>
      </div>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={16}
        strokeWidth={2}
        aria-hidden
        className="shrink-0 text-border transition-all group-hover:translate-x-0.5 group-hover:text-ink"
      />
    </Link>
  );
}
