"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

/**
 * A destructive action with an inline two-step confirm (no separate dialog): the first click swaps the
 * "Delete" affordance for explicit "Cancel / Confirm" buttons. `onConfirm` runs the deletion; the
 * caller decides what happens after (navigate away, optimistically hide).
 */
export function DeleteButton({
  onConfirm,
  label = "Delete",
}: {
  onConfirm: () => Promise<void> | void;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        className="text-muted hover:text-status-declined"
      >
        <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={2} />
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-busy={pending}
        disabled={pending}
        className="border-status-declined/40 text-status-declined hover:bg-status-declined/10"
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await onConfirm();
            // the node unmounts (idea: navigates away; reply: hidden), so no need to reset state
          } catch (e) {
            // stay in the confirming state so the user can retry; surface why it failed
            setError(e instanceof Error && e.message ? e.message : "Could not delete. Try again.");
            setPending(false);
          }
        }}
      >
        {pending ? "Deleting…" : "Confirm"}
      </Button>
      {error ? (
        <span role="alert" aria-live="assertive" className="ml-1 text-xs text-status-declined">
          {error}
        </span>
      ) : null}
    </span>
  );
}
