"use client";

import { useEffect, useState } from "react";
import { useNDK } from "@nostr-dev-kit/react";
import { resolveLnurlPay, type LnurlPayMeta } from "@/lib/zap/lnurl";

const EMPTY: Map<string, LnurlPayMeta> = new Map();
const MAX_ATTEMPTS = 5;

/**
 * Resolve the LNURL-pay trust anchor (the server `nostrPubkey` + sendable bounds) for a set of recipient
 * pubkeys, by reading each one's profile lud16 and fetching their LNURL endpoint. Called only with the
 * (usually empty) set of authors who actually received zaps, so a board with no zaps does zero LNURL HTTP.
 * The map feeds zap-receipt validation; a recipient with no resolvable anchor yields no trusted total.
 *
 * The resolved map is MONOTONIC: an anchor (the server key + bounds) is static, so once resolved it is
 * kept and never dropped. This is deliberate. The previous version rebuilt the whole map on every change,
 * so a transient empty-recipients render (NDK re-subscribe) or a flaky LNURL/profile fetch wiped a good
 * anchor and, because the effect only re-ran on a key change, left the zap total stuck at 0 until a page
 * refresh. Now only un-resolved recipients are fetched, results are merged in, and still-missing ones are
 * retried with backoff (e.g. the kind-0 profile not having arrived yet), so the total settles in place
 * instead of vanishing.
 */
export function useLnurlAnchors(pubkeys: string[]): Map<string, LnurlPayMeta> {
  const { ndk } = useNDK();
  const [anchors, setAnchors] = useState<Map<string, LnurlPayMeta>>(EMPTY);
  const key = pubkeys.join(",");

  useEffect(() => {
    if (!ndk) return;
    let active = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Seed from what we already hold so a retry only chases the genuinely-missing recipients (and an
    // anchor we already have is never re-fetched).
    const have = new Set(anchors.keys());

    const run = async () => {
      const missing = pubkeys.filter((pubkey) => !have.has(pubkey));
      // Empty recipients, or everything already resolved: keep the existing map, touch nothing.
      if (missing.length === 0) return;

      const resolved = new Map<string, LnurlPayMeta>();
      await Promise.all(
        missing.map(async (pubkey) => {
          try {
            const profile = await ndk.getUser({ pubkey }).fetchProfile();
            const lud16 = typeof profile?.lud16 === "string" ? profile.lud16 : null;
            if (!lud16) return;
            const meta = await resolveLnurlPay(lud16);
            if (meta) resolved.set(pubkey, meta);
          } catch {
            // leave unresolved; the backoff retry below will try this recipient again
          }
        }),
      );
      if (!active) return;

      if (resolved.size > 0) {
        for (const pubkey of resolved.keys()) have.add(pubkey);
        // Merge, never replace: a previously-resolved anchor is never dropped by a later partial result.
        setAnchors((prev) => {
          const next = new Map(prev);
          for (const [pubkey, meta] of resolved) next.set(pubkey, meta);
          return next;
        });
      }

      // Retry the recipients that did not resolve (profile not arrived yet / transient endpoint failure)
      // with backoff, so a flaky moment does not leave the zap total at 0 until the user refreshes.
      if (attempt < MAX_ATTEMPTS && pubkeys.some((pubkey) => !have.has(pubkey))) {
        attempt += 1;
        timer = setTimeout(run, Math.min(8000, 1500 * attempt));
      }
    };

    void run();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // `anchors` is intentionally excluded: it is read once to seed `have`, and including it would re-run
    // the effect on every merge. The effect re-runs only when the recipient set (key) or ndk changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk, key]);

  return anchors;
}
