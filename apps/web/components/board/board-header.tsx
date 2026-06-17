"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, PencilEdit01Icon, PlusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { Board } from "@voxboard/protocol";
import { Avatar } from "@/components/ui/avatar";
import { AttestedBadge } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { npubShort } from "@/lib/format";

/**
 * Board masthead. The identity row (square board tile + name) carries the action cluster on its right; the
 * description and meta then DROP to their own rows that run the full content-column measure — no narrowing
 * cap, no avatar indent — so the details sit flush with the column's left and right edges. Single-accent
 * rule: only "New idea" is accent-filled; Edit + Copy are quiet icon-only secondaries. Client component:
 * Copy holds a brief, self-clearing "Copied" affordance (the app has no global toast helper).
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
      {/* Identity row: avatar + name flush-left, action cluster aligned right (stacks on mobile). The name
          is top-aligned to the tile so a wrapped two-line name reads from the tile's cap height. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar pubkey={board.pubkey} src={board.image?.url} alt={board.name} size="lg" shape="square" />
          <h1 className="min-w-0 break-words font-display font-display-lg text-3xl font-semibold leading-tight tracking-tight text-ink">
            {board.name}
          </h1>
        </div>
        <BoardActions onNewIdea={onNewIdea} onEdit={onEdit} onCopyLink={onCopyLink} />
      </div>

      {/* Full-measure details: description and meta drop the cap and the avatar indent, so they run the
          content column's full width, flush to its left edge. */}
      {board.description ? (
        <p className="mt-4 break-words text-sm leading-relaxed text-muted">{board.description}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
        {attested ? <AttestedBadge /> : null}
        <span className="tabular-nums">{npubShort(board.pubkey)}</span>
        {typeof ideaCount === "number" ? (
          <span className="tabular-nums">
            {ideaCount} {ideaCount === 1 ? "idea" : "ideas"}
          </span>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Action cluster: New idea (primary, always), Edit (owner-only), Copy link (working secondary). New idea
 * is the sole accent fill; Edit + Copy are icon-only outline squares at every width (36px touch targets,
 * each labelled via aria-label + title). Copy swaps to a tick glyph + "Copied" for ~1.5s as quiet
 * confirmation, since the app has no toast helper.
 */
function BoardActions({
  onNewIdea,
  onEdit,
  onCopyLink,
}: {
  onNewIdea?: () => void;
  onEdit?: () => void;
  onCopyLink?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopyLink?.();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const copyLabel = copied ? "Link copied" : "Copy link";

  return (
    <div className="flex shrink-0 items-center gap-2 sm:justify-end">
      {onEdit ? (
        <Button variant="outline" size="icon" onClick={onEdit} aria-label="Edit board" title="Edit board">
          <HugeiconsIcon icon={PencilEdit01Icon} size={16} strokeWidth={2} />
        </Button>
      ) : null}
      {onCopyLink ? (
        <Button variant="outline" size="icon" onClick={handleCopy} aria-label={copyLabel} title={copyLabel}>
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={16} strokeWidth={2} />
        </Button>
      ) : null}
      <Button size="md" onClick={onNewIdea}>
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
        New idea
      </Button>
    </div>
  );
}
