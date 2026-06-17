"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Clock01Icon, Fire02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export type SortKey = "trending" | "top" | "new";

const SORTS = [
  { key: "trending" as const, label: "Trending", icon: Fire02Icon },
  { key: "top" as const, label: "Top", icon: ArrowUp01Icon },
  { key: "new" as const, label: "New", icon: Clock01Icon },
];

// How many category chips to show before collapsing the rest behind "+N more". The active category is
// always kept visible even when collapsed, so a deep-linked / persisted filter never hides off-screen.
const COLLAPSED_LIMIT = 5;

/** Sort segmented control + category filter. Controlled by the board container.
 *  Categories collapse to the first few + a "+N more" / "Show less" toggle so a board with many tags
 *  doesn't wrap into a wall of chips in the dense max-w-3xl column. */
export function FeedToolbar({
  sort,
  onSort,
  categories,
  activeCategory,
  onCategory,
}: {
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  categories: string[];
  activeCategory: string | null;
  onCategory: (category: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const overflowing = categories.length > COLLAPSED_LIMIT;
  const overflowCount = categories.length - COLLAPSED_LIMIT;
  // When collapsed, show the first N. If the active category sits past that cut, append it so the
  // current filter is always on screen (it keeps its real position when expanded).
  const head = categories.slice(0, COLLAPSED_LIMIT);
  const activeHidden =
    !expanded &&
    overflowing &&
    activeCategory !== null &&
    !head.includes(activeCategory) &&
    categories.includes(activeCategory);
  const shown = expanded ? categories : activeHidden ? [...head, activeCategory] : head;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
      <div
        role="group"
        aria-label="Sort ideas"
        className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
      >
        {SORTS.map((option) => {
          const active = sort === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onSort(option.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                active ? "bg-surface-2 font-medium text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              <HugeiconsIcon icon={option.icon} size={14} strokeWidth={2} />
              {option.label}
            </button>
          );
        })}
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryButton active={activeCategory === null} onClick={() => onCategory(null)}>
            All
          </CategoryButton>
          {shown.map((category) => (
            <CategoryButton
              key={category}
              active={activeCategory === category}
              onClick={() => onCategory(category)}
              title={category}
            >
              {category}
            </CategoryButton>
          ))}
          {overflowing ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={expanded ? "Show fewer categories" : `Show ${overflowCount} more categories`}
              className={cn(
                "inline-flex h-8 items-center rounded-full border border-border px-2.5 text-xs font-medium transition-colors",
                "text-muted hover:bg-surface-2 hover:text-ink",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              )}
            >
              {expanded ? "Show less" : `+${overflowCount} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CategoryButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** full tag text, so a truncated long category stays recoverable on hover / touch */
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "inline-flex h-8 max-w-40 items-center rounded-full border px-2.5 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        // Match the sort control's restraint instead of a jet-black pill: a passive filter shouldn't be
        // the loudest element on the board (the accent + status hues need that attention budget).
        active
          ? "border-border bg-surface-2 font-medium text-ink shadow-card"
          : "border-border text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {/* min-w-0 lets the label shrink inside the flex button so a long tag ellipsizes at max-w-40. */}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}
