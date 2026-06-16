import { STATUS_LABEL, type Status } from "@voxboard/protocol";
import { cn } from "@/lib/utils";

const DOT: Record<Status, string> = {
  open: "bg-status-open",
  "under-review": "bg-status-under-review",
  backlog: "bg-status-backlog",
  planned: "bg-status-planned",
  "in-progress": "bg-status-in-progress",
  implemented: "bg-status-implemented",
  declined: "bg-status-declined",
  duplicate: "bg-status-duplicate",
  closed: "bg-status-closed",
};

const TEXT: Record<Status, string> = {
  open: "text-status-open",
  "under-review": "text-status-under-review",
  backlog: "text-status-backlog",
  planned: "text-status-planned",
  "in-progress": "text-status-in-progress",
  implemented: "text-status-implemented",
  declined: "text-status-declined",
  duplicate: "text-status-duplicate",
  closed: "text-status-closed",
};

// Faint status-tinted ground for the `tint` label variant, so the hue is legible at a glance without
// going loud. Stays within the "subtle surface shift + hairline" depth language (a ~10% wash).
const TINT: Record<Status, string> = {
  open: "bg-status-open/10",
  "under-review": "bg-status-under-review/10",
  backlog: "bg-status-backlog/10",
  planned: "bg-status-planned/10",
  "in-progress": "bg-status-in-progress/10",
  implemented: "bg-status-implemented/10",
  declined: "bg-status-declined/10",
  duplicate: "bg-status-duplicate/10",
  closed: "bg-status-closed/10",
};

/**
 * A tiny inline filled status dot (signature move from DESIGN.md, not a heavy badge). With `showLabel`
 * it reads as `● Planned` in the status hue; without, it is a labelled dot for color-blind safety.
 * `tint` lifts the label onto a faint status-colored pill so it is scannable in a column of gray meta.
 */
export function StatusDot({
  status,
  showLabel = false,
  tint = false,
  className,
}: {
  status: Status;
  showLabel?: boolean;
  tint?: boolean;
  className?: string;
}) {
  if (showLabel) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide",
          TEXT[status],
          tint && cn("rounded-full px-2 py-0.5", TINT[status]),
          className,
        )}
      >
        <span className={cn("size-2 rounded-full", DOT[status])} aria-hidden />
        {STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-block size-2 rounded-full", DOT[status], className)}
      role="img"
      aria-label={STATUS_LABEL[status]}
    />
  );
}
