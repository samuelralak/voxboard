import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, PencilEdit01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import type { Board } from "@voxboard/protocol";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { npubShort } from "@/lib/format";

/** Board masthead: icon, name (display serif), description, owner npub + idea count, and actions. */
export function BoardHeader({
  board,
  ideaCount,
  onCopyLink,
  onNewIdea,
  onEdit,
}: {
  board: Board;
  ideaCount?: number;
  onCopyLink?: () => void;
  onNewIdea?: () => void;
  onEdit?: () => void;
}) {
  return (
    <header className="flex flex-col gap-4 py-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <Avatar pubkey={board.pubkey} src={board.image?.url} alt={board.name} size="lg" shape="square" />
        <div className="min-w-0">
          <h1 className="break-words font-display font-display-lg text-3xl font-semibold leading-tight tracking-tight text-ink">
            {board.name}
          </h1>
          {board.description ? (
            <p className="mt-1 max-w-2xl break-words text-sm leading-relaxed text-muted">{board.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
            <span className="tabular-nums">{npubShort(board.pubkey)}</span>
            {typeof ideaCount === "number" ? (
              <span className="tabular-nums">
                {ideaCount} {ideaCount === 1 ? "idea" : "ideas"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {onEdit ? (
          <Button variant="outline" size="md" onClick={onEdit} aria-label="Edit board">
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} strokeWidth={2} />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        ) : null}
        <Button variant="outline" size="md" onClick={onCopyLink} aria-label="Copy link">
          <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={2} />
          <span className="hidden sm:inline">Copy link</span>
        </Button>
        <Button size="md" onClick={onNewIdea}>
          <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
          New idea
        </Button>
      </div>
    </header>
  );
}
