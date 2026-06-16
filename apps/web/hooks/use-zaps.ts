"use client";

import { useMemo } from "react";
import { useSubscribe } from "@nostr-dev-kit/react";
import { KIND, parseZapReceipt, zapTotalsByTarget, type ZapTotal } from "@voxboard/protocol";
import { useDeletedIds } from "./use-deletions";
import { useLnurlAnchors } from "./use-lnurl-anchors";
import { ndkFilter, toNostrEvents } from "@/lib/nostr/event";

const EMPTY_TOTAL: ZapTotal = { sats: 0, msat: BigInt(0), zapCount: 0, senders: new Set() };

/**
 * Live, validated, deduped zap totals for a set of target ids, keyed by target id. Subscribes to the
 * kind-9735 receipts referencing those ids, resolves the LNURL trust anchor for each recipient who
 * actually has receipts, then runs the forgery-resistant zapTotalsByTarget. A receipt whose recipient
 * anchor cannot be resolved contributes 0 (fail-closed) — only validated, anchored zaps are summed.
 */
export function useZaps(ids: string[], authorByTarget: Map<string, string>): Map<string, ZapTotal> {
  const sub = useSubscribe(
    ids.length > 0 ? [ndkFilter({ kinds: [KIND.ZapReceipt], "#e": ids })] : false,
    {},
    [ids.join(",")],
  );

  const events = useMemo(() => toNostrEvents(sub.events), [sub.events]);
  // The recipient/server can NIP-09 a receipt; honor that.
  const hidden = useDeletedIds(events);
  const live = useMemo(() => events.filter((e) => !hidden.has(e.id)), [events, hidden]);

  // Resolve anchors ONLY for authors who actually received a (structurally valid) receipt — usually none.
  const recipients = useMemo(() => {
    const set = new Set<string>();
    for (const event of live) {
      const parsed = parseZapReceipt(event);
      if (!parsed) continue;
      const recipient = authorByTarget.get(parsed.targetEventId ?? "");
      if (recipient) set.add(recipient);
    }
    return [...set];
  }, [live, authorByTarget]);

  const anchors = useLnurlAnchors(recipients);

  return useMemo(
    () =>
      zapTotalsByTarget(live, (receipt) => {
        const recipient = authorByTarget.get(receipt.targetEventId ?? "");
        if (!recipient) return null;
        const meta = anchors.get(recipient);
        const expectation: {
          targetEventId: string;
          recipientPubkey: string;
          lnurlNostrPubkey?: string;
          minSendableMsat?: bigint;
          maxSendableMsat?: bigint;
        } = {
          targetEventId: receipt.targetEventId ?? "",
          recipientPubkey: recipient,
        };
        if (meta) {
          expectation.lnurlNostrPubkey = meta.nostrPubkey;
          expectation.minSendableMsat = meta.minSendableMsat;
          expectation.maxSendableMsat = meta.maxSendableMsat;
        }
        return expectation;
      }),
    [live, anchors, authorByTarget],
  );
}

/** Single-target convenience for the detail page. */
export function useZap(id: string | null, author: string | null): ZapTotal {
  const ids = useMemo(() => (id ? [id] : []), [id]);
  const map = useMemo(() => (id && author ? new Map([[id, author]]) : new Map<string, string>()), [id, author]);
  const totals = useZaps(ids, map);
  return id ? totals.get(id) ?? EMPTY_TOTAL : EMPTY_TOTAL;
}
