"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import type { Idea } from "@voxboard/protocol";
import type { Moderation } from "@/hooks/use-moderation";
import { Button } from "@/components/ui/button";
import { npubShort } from "@/lib/format";

function ApproveButton({ onApprove }: { onApprove: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  // No permanent "Approved" latch: once the approval propagates the row leaves the pending queue and
  // unmounts on its own. If it never echoes back (relay drop), the button returns to "Approve" so the
  // owner can retry instead of being stuck on an inert control.
  return (
    <Button
      size="sm"
      disabled={pending}
      aria-busy={pending}
      className="shrink-0"
      onClick={async () => {
        setPending(true);
        try {
          await onApprove();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? null : <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} strokeWidth={2} />}
      {pending ? "Approving…" : "Approve"}
    </Button>
  );
}

/**
 * Curated-board approval queue, shown only to the owner/mods: ideas awaiting approval (kind 4550).
 * Approving publishes the approval; the idea then moves into the public feed once it propagates.
 */
export function PendingApprovals({ pending, moderation }: { pending: Idea[]; moderation: Moderation }) {
  if (!moderation.canModerate || pending.length === 0) return null;
  return (
    <section aria-live="polite" className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <h2 className="font-mono text-xs uppercase tracking-widest tabular-nums text-accent">
        Pending approval ({pending.length})
      </h2>
      <div className="mt-3 space-y-2">
        {pending.map((idea) => (
          <div key={idea.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{idea.title}</p>
              <p className="font-mono text-xs text-muted">{npubShort(idea.pubkey)}</p>
            </div>
            <ApproveButton onApprove={() => moderation.approve(idea.raw)} />
          </div>
        ))}
      </div>
    </section>
  );
}
