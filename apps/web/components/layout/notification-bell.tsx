"use client";

import Link from "next/link";
import { ElDropdown, ElMenu } from "@tailwindplus/elements/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Comment01Icon,
  FlashIcon,
  Notification01Icon,
} from "@hugeicons/core-free-icons";
import { KIND, ideaNevent } from "@voxboard/protocol";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications, type NotificationItem } from "@/hooks/use-notifications";
import { fullTime, isoTime, npubShort, timeAgo } from "@/lib/format";

function describe(item: NotificationItem): { icon: typeof Comment01Icon; label: string } {
  if (item.kind === KIND.Reaction) {
    const c = item.raw.content.trim();
    if (c === "-") return { icon: ArrowDown01Icon, label: "Downvoted your post" };
    if (c === "+" || c === "") return { icon: ArrowUp01Icon, label: "Upvoted your post" };
    return { icon: ArrowUp01Icon, label: "Reacted to your post" };
  }
  if (item.kind === KIND.ZapReceipt) return { icon: FlashIcon, label: "Zapped your post" };
  return { icon: Comment01Icon, label: "Commented on your post" };
}

function NotifRow({ item, self }: { item: NotificationItem; self: string }) {
  const { icon, label } = describe(item);
  const inner = (
    <div className="flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-surface-2">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
        <HugeiconsIcon icon={icon} size={14} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{label}</p>
        <p className="truncate text-xs text-muted">
          <span className="font-mono">{npubShort(item.author)}</span>
          <span className="text-border"> · </span>
          <time suppressHydrationWarning dateTime={isoTime(item.createdAt)} title={fullTime(item.createdAt)}>{timeAgo(item.createdAt)}</time>
        </p>
      </div>
    </div>
  );
  if (!item.targetId) return inner;
  return (
    <Link href={`/d/${ideaNevent({ id: item.targetId, author: self })}`} className="block">
      {inner}
    </Link>
  );
}

/** Header notifications bell: unread count badge + a dropdown of recent interactions. Self-gates on login. */
export function NotificationBell() {
  const { loggedIn, pubkey } = useAuth();
  const { items, unread, markSeen } = useNotifications();
  if (!loggedIn || !pubkey) return null;

  return (
    <ElDropdown className="relative inline-block">
      <button
        type="button"
        onClick={markSeen}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-flex size-9 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <HugeiconsIcon icon={Notification01Icon} size={16} strokeWidth={2} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-xs font-semibold tabular-nums leading-none text-canvas">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      <ElMenu
        popover="auto"
        {...{ anchor: "bottom end" }}
        className="mt-2 w-80 origin-top-right overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-pop [&:not(:popover-open)]:hidden"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted">Notifications</p>
        {items.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-muted">No notifications yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <NotifRow key={item.id} item={item} self={pubkey} />
            ))}
          </div>
        )}
      </ElMenu>
    </ElDropdown>
  );
}
