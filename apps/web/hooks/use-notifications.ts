"use client";

import { useCallback, useMemo } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { NDKSubscriptionCacheUsage } from "@nostr-dev-kit/ndk";
import { KIND, parseZapReceipt, type NostrEvent } from "@voxboard/protocol";
import { useAuth } from "./use-auth";
import { useDeletedIds } from "./use-deletions";
import { useLocalStorage } from "./use-local-storage";
import { ndkFilter, toNostrEvents } from "@/lib/nostr/event";

const WINDOW_SECONDS = 60 * 60 * 24 * 30; // 30-day lookback, to bound relay load
const MAX_ITEMS = 30;
const HEX64 = /^[0-9a-f]{64}$/i;

export interface NotificationItem {
  id: string;
  /** 1111 reply, 7 vote, 9735 zap */
  kind: number;
  author: string;
  createdAt: number;
  /** the e tag (the idea/reply being acted on), if present */
  targetId?: string;
  raw: NostrEvent;
}

export interface Notifications {
  items: NotificationItem[];
  unread: number;
  /** mark everything currently visible as seen (clears the badge) */
  markSeen: () => void;
}

/**
 * In-app notifications: a single `#p`-scoped subscription over replies (1111), votes (7), and zap
 * receipts (9735) that reference the signed-in user — i.e. interactions with their content. Unread is
 * counted against a per-user last-seen ts in localStorage. Gated on login.
 *
 * KNOWN LIMITATION (routing): on a *board* page, the board's own kind-1111 `#A` feed subscription claims
 * reply events at NDK's cache/routing layer, so some reply notifications are under-counted there (votes +
 * zaps are unaffected). The count is complete on every other surface (home / discover / profile / idea).
 *
 * KNOWN LIMITATION (trust): a `#p` tag is self-asserted — anyone can publish a kind-7/1111/9735 tagging
 * any pubkey, so the feed is inherently spoofable. We harden what is cheap (a 9735 actor is recovered
 * from its embedded 9734 rather than trusting the receipt's signer; malformed target ids are rejected
 * before nip19 encoding), but we deliberately do NOT prove each item actually references the viewer's own
 * content — that would need a second round-trip per item to fetch + verify the target. Notifications are
 * a low-stakes read surface (they never gate money, moderation, or counts), so an unverified `#p` is
 * acceptable here; the forgery-resistant paths (zap totals, vote tallies) live in the aggregate, not here.
 */
export function useNotifications(): Notifications {
  const { pubkey, loggedIn } = useAuth();
  const [lastSeen, setLastSeen] = useLocalStorage<number>(`vox:notif:lastSeen:${pubkey ?? "anon"}`, 0);

  // Stable `since` per login so the subscription doesn't churn.
  const since = useMemo(() => Math.floor(Date.now() / 1000) - WINDOW_SECONDS, [pubkey]);

  // cacheUsage: ONLY_RELAY is load-bearing. On a board / idea page the provider's `#A` feed sub receives
  // and caches the reply first; the Dexie cache adapter does NOT index `#p` tags, so a default CACHE_FIRST
  // `#p` query then misses it and the bell silently under-counts (verified: idea pages showed 0 before
  // this). Querying relays directly side-steps the cache gap. groupable:false keeps it its own REQ (a
  // notification is a distinct concern, not part of the feed). Probe: apps/web/e2e (board-page spec).
  const sub = useSubscribe(
    loggedIn && pubkey
      ? [ndkFilter({ kinds: [KIND.Comment, KIND.Reaction, KIND.ZapReceipt], "#p": [pubkey], since })]
      : false,
    { groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY },
    [pubkey],
  );

  const events = useMemo(() => toNostrEvents(sub.events), [sub.events]);
  const hidden = useDeletedIds(events);

  const items = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = [];
    for (const event of events) {
      if (hidden.has(event.id)) continue;
      // A kind-9735 receipt is signed by the LNURL server, not the zapper — recover the real actor from
      // the embedded 9734 so the actor is right AND a self-zap is filtered like any other own action.
      let author = event.pubkey;
      if (event.kind === KIND.ZapReceipt) {
        const parsed = parseZapReceipt(event);
        if (!parsed) continue;
        author = parsed.request.pubkey;
      }
      if (author === pubkey) continue; // not your own actions
      // Validate the target id is a real event id before it can reach nip19 encoding (a malformed e-tag
      // would otherwise throw during render of the header-mounted bell, blanking every page).
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      const targetId = eTag && HEX64.test(eTag) ? eTag.toLowerCase() : undefined;
      out.push({
        id: event.id,
        kind: event.kind,
        author,
        createdAt: event.created_at,
        ...(targetId ? { targetId } : {}),
        raw: event,
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, MAX_ITEMS);
  }, [events, pubkey, hidden]);

  const unread = useMemo(() => items.filter((item) => item.createdAt > lastSeen).length, [items, lastSeen]);

  const markSeen = useCallback(() => {
    setLastSeen(Math.floor(Date.now() / 1000));
  }, [setLastSeen]);

  return { items, unread, markSeen };
}
