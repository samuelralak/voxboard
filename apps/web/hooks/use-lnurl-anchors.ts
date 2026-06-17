"use client";

import { useEffect, useState } from "react";
import { useNDK } from "@nostr-dev-kit/react";
import { resolveLnurlPay, type LnurlPayMeta } from "@/lib/zap/lnurl";

const EMPTY: Map<string, LnurlPayMeta> = new Map();
const MAX_ATTEMPTS = 5;

/**
 * Resolve the LNURL-pay trust anchor (the server `nostrPubkey` + sendable bounds) for a set of recipient
 * pubkeys, by reading each one's lud16 and fetching their LNURL endpoint. Called only with the (usually
 * empty) set of authors who actually received zaps, so a board with no zaps does zero LNURL HTTP. The map
 * feeds zap-receipt validation; a recipient with no resolvable anchor yields no trusted total.
 *
 * `lud16ByPubkey` lets a caller hand in a lud16 it ALREADY resolved reactively (the idea page knows the
 * author's lud16 from its profile hook). We prefer it and skip the profile fetch — and, crucially, the
 * lud16 is folded into the effect key, so the anchor resolves the instant the profile arrives instead of
 * racing a one-shot fetchProfile that, on a cold load, could miss and leave the zap total at 0 until a
 * refresh. When no lud16 is supplied we fall back to fetchProfile (with retry).
 *
 * The resolved map is MONOTONIC: an anchor (server key + bounds) is static, so once resolved it is kept
 * and never dropped. The previous version rebuilt the whole map on every change, so a transient
 * empty-recipients render (NDK re-subscribe) or a flaky fetch wiped a good anchor; only un-resolved
 * recipients are fetched now, results are merged, and stragglers are retried with backoff.
 */
export function useLnurlAnchors(
  pubkeys: string[],
  lud16ByPubkey?: Map<string, string>,
): Map<string, LnurlPayMeta> {
  const { ndk } = useNDK();
  const [anchors, setAnchors] = useState<Map<string, LnurlPayMeta>>(EMPTY);
  // Key changes when the recipient set changes OR when a recipient's known lud16 arrives, so the anchor
  // resolves reactively the moment the profile loads.
  const key = pubkeys.map((pubkey) => `${pubkey}:${lud16ByPubkey?.get(pubkey) ?? ""}`).join(",");

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
            // Prefer a lud16 the caller already resolved reactively; only fetch the profile as a fallback.
            let lud16 = lud16ByPubkey?.get(pubkey) ?? null;
            if (!lud16) {
              const profile = await ndk.getUser({ pubkey }).fetchProfile();
              lud16 = typeof profile?.lud16 === "string" ? profile.lud16 : null;
            }
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
    // the effect on every merge. The effect re-runs only when the recipient set / known lud16 (key) or
    // ndk changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk, key]);

  return anchors;
}
