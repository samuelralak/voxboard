"use client";

import { useId } from "react";
import { ElDropdown, ElMenu } from "@tailwindplus/elements/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Shield01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { STATUS, STATUS_LABEL, type Status } from "@voxboard/protocol";
import type { Moderation } from "@/hooks/use-moderation";

const itemClass =
  "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

/**
 * Owner/moderator action menu on an idea: set status, pin/unpin, lock the thread, hide the idea, ban
 * the author. Each item publishes a NIP-32 label (or a ban) via useModeration; the read path enforces
 * it. Rendered only when `moderation.canModerate`.
 */
export function ModerationMenu({
  moderation,
  ideaId,
  authorPubkey,
  pinned,
  status,
}: {
  moderation: Moderation;
  ideaId: string;
  authorPubkey: string;
  pinned: boolean;
  status?: Status;
}) {
  const menuId = useId();
  const close = () => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(menuId);
    if (el && "hidePopover" in el) (el as HTMLElement).hidePopover();
  };
  const run = (fn: () => Promise<void>) => {
    void fn();
    close();
  };

  return (
    <ElDropdown className="relative inline-block text-left">
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <HugeiconsIcon icon={Shield01Icon} size={14} strokeWidth={2} />
        Moderate
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} className="text-muted" />
      </button>

      <ElMenu
        id={menuId}
        popover="auto"
        {...{ anchor: "bottom end" }}
        className="w-56 origin-top-right rounded-xl border border-border bg-surface p-1.5 shadow-pop [&:not(:popover-open)]:hidden"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted">Set status</p>
        {STATUS.map((s) => (
          <button key={s} type="button" className={itemClass} onClick={() => run(() => moderation.setStatus(ideaId, s))}>
            {STATUS_LABEL[s]}
            {status === s ? (
              <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2} className="text-accent" aria-label="current" />
            ) : null}
          </button>
        ))}

        <hr className="my-1.5 border-border" />

        <button type="button" className={itemClass} onClick={() => run(() => (pinned ? moderation.unpin(ideaId) : moderation.pin(ideaId)))}>
          {pinned ? "Unpin idea" : "Pin idea"}
        </button>
        <button type="button" className={itemClass} onClick={() => run(() => moderation.lock(ideaId))}>
          Lock thread
        </button>
        <button type="button" className={itemClass} onClick={() => run(() => moderation.hide(ideaId))}>
          Hide idea
        </button>

        <hr className="my-1.5 border-border" />

        <button
          type="button"
          className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-status-declined transition-colors hover:bg-status-declined/10 focus-visible:outline-none"
          onClick={() => {
            // Close the popover first, then confirm, so the dialog doesn't race the popover teardown.
            close();
            if (typeof window !== "undefined" && !window.confirm("Ban this author from the board? Their posts and votes stop counting.")) return;
            void moderation.ban(authorPubkey);
          }}
        >
          Ban author
        </button>
      </ElMenu>
    </ElDropdown>
  );
}
