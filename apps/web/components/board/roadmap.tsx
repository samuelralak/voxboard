"use client";

import { useId } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Comment01Icon } from "@hugeicons/core-free-icons";
import { ROADMAP_COLUMNS, STATUS_LABEL, ideaNevent, type Status } from "@voxboard/protocol";
import type { IdeaRow } from "@/hooks/use-board-data";
import { StatusDot } from "@/components/ui/status-dot";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROADMAP_SET = new Set<Status>(ROADMAP_COLUMNS);

/**
 * Roadmap kanban: ideas grouped into the pipeline columns (ROADMAP_COLUMNS), derived from their
 * collapsed status. An idea with no status sits in "open"; terminal states (declined/duplicate/closed)
 * are off the roadmap and omitted. Pure presentation over the same IdeaRows the feed renders.
 */
export function Roadmap({ rows }: { rows: IdeaRow[] }) {
  const headingPrefix = useId();
  const byColumn = new Map<Status, IdeaRow[]>(ROADMAP_COLUMNS.map((c) => [c, []]));
  let terminal = 0;
  for (const row of rows) {
    const column = row.status && ROADMAP_SET.has(row.status) ? row.status : !row.status ? "open" : null;
    if (column) byColumn.get(column)!.push(row);
    else terminal += 1; // declined / duplicate / closed: off the pipeline
  }

  return (
    <>
      {/* roadmap-rail masks the right edge so the clipped column reads as "more to the right"; the
          region is focusable so it can be scrolled with the arrow keys, and snaps to column edges. */}
      <div
        role="region"
        aria-label="Roadmap columns"
        tabIndex={0}
        className="roadmap-rail mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-lg pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        {ROADMAP_COLUMNS.map((column) => {
          const items = byColumn.get(column)!;
          return (
            <section
              key={column}
              aria-labelledby={`${headingPrefix}-${column}`}
              className="flex w-64 shrink-0 snap-start flex-col"
            >
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <StatusDot status={column} />
                <span
                  id={`${headingPrefix}-${column}`}
                  className="text-sm font-medium uppercase tracking-wide text-ink"
                >
                  {STATUS_LABEL[column]}
                </span>
                {/* digit is decorative; the sr-only sibling carries the accessible "N ideas" (aria-label
                    on a generic span is ARIA-prohibited and dropped by some screen readers). */}
                <span className="font-mono text-xs tabular-nums text-muted" aria-hidden>
                  {items.length}
                </span>
                <span className="sr-only">
                  {items.length} {items.length === 1 ? "idea" : "ideas"}
                </span>
              </div>
              <div className="space-y-2 rounded-xl bg-surface-2/50 p-2">
                {items.length === 0 ? (
                  <div className="flex min-h-24 items-center justify-center px-1">
                    <p className="text-center text-xs text-muted">Nothing here yet</p>
                  </div>
                ) : (
                  items.map((row) => (
                    <Link
                      key={row.idea.id}
                      href={`/d/${ideaNevent({ id: row.idea.id, author: row.idea.pubkey })}`}
                      className="block rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <p className="line-clamp-2 break-words font-display text-sm font-semibold leading-snug tracking-tight text-ink">
                        {row.idea.title}
                      </p>
                      <div className="mt-2 flex items-center gap-3 font-mono text-xs tabular-nums text-muted">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 font-semibold",
                            row.tally.score > 0 ? "text-ink" : row.tally.score < 0 ? "text-status-declined" : "",
                          )}
                        >
                          <HugeiconsIcon icon={ArrowUp01Icon} size={12} strokeWidth={2.5} aria-hidden />
                          {formatCount(row.tally.score)}
                        </span>
                        {row.replyCount > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <HugeiconsIcon icon={Comment01Icon} size={12} strokeWidth={2} aria-hidden />
                            {formatCount(row.replyCount)}
                            <span className="sr-only">replies</span>
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
      {terminal > 0 ? (
        <p className="mt-2 px-1 text-xs text-muted">
          <span className="font-mono tabular-nums">{terminal}</span> closed, declined, or duplicate{" "}
          {terminal === 1 ? "idea is" : "ideas are"} off the roadmap.
        </p>
      ) : null}
    </>
  );
}
