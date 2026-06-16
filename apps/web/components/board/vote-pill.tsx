import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronUpIcon, ChevronDownIcon } from "@hugeicons/core-free-icons";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The vote control: a compact vertical up / score / down stack. Deliberately NOT a bordered box
 * (which read as a number-stepper). The score is the bold focal point; the chevrons are quiet buttons
 * that light up (green on upvote, rose on downvote) on hover/active. `self-start` keeps it from
 * stretching to the row/article height. Read-only until the signer lands in M2.
 */
export function VotePill({
  score,
  myVote = null,
  onUp,
  onDown,
  disabled = false,
  className,
}: {
  score: number;
  myVote?: "up" | "down" | null;
  onUp?: () => void;
  onDown?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex w-10 shrink-0 flex-col items-center self-start pt-0.5", className)}>
      <button
        type="button"
        onClick={onUp}
        disabled={disabled}
        aria-label="Upvote"
        aria-pressed={myVote === "up"}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          myVote === "up" ? "text-status-implemented" : "text-muted",
          // read-only: quiet the chevrons so the score is the focal point until voting lands
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-surface-2 hover:text-status-implemented",
        )}
      >
        <HugeiconsIcon icon={ChevronUpIcon} size={18} strokeWidth={2.5} aria-hidden />
      </button>

      <span
        aria-live="polite"
        aria-atomic
        aria-label={`Score ${score}`}
        className={cn(
          "py-0.5 font-mono text-sm font-semibold tabular-nums",
          score > 0 ? "text-ink" : score < 0 ? "text-status-declined" : "text-muted",
        )}
      >
        {formatCount(score)}
      </span>

      <button
        type="button"
        onClick={onDown}
        disabled={disabled}
        aria-label="Downvote"
        aria-pressed={myVote === "down"}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          myVote === "down" ? "text-status-declined" : "text-muted",
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-surface-2 hover:text-status-declined",
        )}
      >
        <HugeiconsIcon icon={ChevronDownIcon} size={18} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}
