import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Clock01Icon, Fire02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export type SortKey = "trending" | "top" | "new";

const SORTS = [
  { key: "trending" as const, label: "Trending", icon: Fire02Icon },
  { key: "top" as const, label: "Top", icon: ArrowUp01Icon },
  { key: "new" as const, label: "New", icon: Clock01Icon },
];

/** Sort segmented control + category filter. Controlled by the board container. */
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
      <div role="group" aria-label="Sort ideas" className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
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
          {categories.map((category) => (
            <CategoryButton
              key={category}
              active={activeCategory === category}
              onClick={() => onCategory(category)}
            >
              {category}
            </CategoryButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-2.5 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        // Match the sort control's restraint instead of a jet-black pill: a passive filter shouldn't be
        // the loudest element on the board (the accent + status hues need that attention budget).
        active
          ? "border-border bg-surface-2 font-medium text-ink shadow-card"
          : "border-border text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
