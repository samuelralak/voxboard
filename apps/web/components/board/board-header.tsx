import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, PencilEdit01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import type { Board } from "@voxboard/protocol";
import { Avatar } from "@/components/ui/avatar";
import { AttestedBadge } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { npubShort } from "@/lib/format";

/**
 * Board masthead. Identity (icon + name + owner npub + idea count + attested badge) and the actions share
 * one full-width bar; the description then spans the content column on its own row beneath, so it is never
 * pinned into a narrow left gutter. Secondary actions (copy / edit) are quiet icon buttons so the single
 * accent stays on the primary "New idea" CTA. The name scales down on mobile and the labels collapse so the
 * bar never crowds at small widths.
 */
export function BoardHeader({
  board,
  ideaCount,
  attested = false,
  onCopyLink,
  onNewIdea,
  onEdit,
}: {
  board: Board;
  ideaCount?: number;
  /** platform-attested board (drives the "Attested" badge) */
  attested?: boolean;
  onCopyLink?: () => void;
  onNewIdea?: () => void;
  onEdit?: () => void;
}) {
  return (
    <header className="py-8">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Avatar pubkey={board.pubkey} src={board.image?.url} alt={board.name} size="lg" shape="square" />
          <div className="min-w-0">
            <h1 className="break-words font-display font-display-lg text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
              {board.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
              {attested ? <AttestedBadge /> : null}
              <span className="tabular-nums">{npubShort(board.pubkey)}</span>
              {typeof ideaCount === "number" ? (
                <span className="tabular-nums">
                  {ideaCount} {ideaCount === 1 ? "idea" : "ideas"}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="md" onClick={onCopyLink} aria-label="Copy link" title="Copy link">
            <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={2} />
          </Button>
          {onEdit ? (
            <Button variant="outline" size="md" onClick={onEdit} aria-label="Edit board" title="Edit board">
              <HugeiconsIcon icon={PencilEdit01Icon} size={16} strokeWidth={2} />
            </Button>
          ) : null}
          <Button size="md" onClick={onNewIdea}>
            <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
            <span className="hidden sm:inline">New idea</span>
          </Button>
        </div>
      </div>

      {board.description ? (
        <p className="mt-5 max-w-3xl break-words text-base leading-relaxed text-muted">{board.description}</p>
      ) : null}
    </header>
  );
}
