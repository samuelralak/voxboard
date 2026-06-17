"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon, type FlashIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

/**
 * One donation method: an icon, a label + note, and the address in a mono box with a copy button. The
 * address is data, so it renders in mono and truncates; copy gives a brief "Copied" confirmation (the
 * app has no toast helper). `tint="zap"` marks the Lightning method with the sanctioned zap hue.
 */
export function DonateMethod({
  kind,
  note,
  icon,
  value,
  tint = "ink",
}: {
  kind: string;
  note: string;
  icon: typeof FlashIcon;
  value: string;
  tint?: "zap" | "ink";
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator !== "undefined") void navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md border border-border bg-canvas",
            tint === "zap" ? "text-zap" : "text-ink",
          )}
        >
          <HugeiconsIcon icon={icon} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{kind}</p>
          <p className="text-xs text-muted">{note}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{value}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Address copied" : `Copy ${kind} address`}
          className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={13} strokeWidth={2} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
