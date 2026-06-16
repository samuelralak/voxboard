"use client";

import { useEffect, useState } from "react";
import { useNDK } from "@nostr-dev-kit/react";
import { resolveLnurlPay, type LnurlPayMeta } from "@/lib/zap/lnurl";

const EMPTY: Map<string, LnurlPayMeta> = new Map();

/**
 * Resolve the LNURL-pay trust anchor (the server `nostrPubkey` + sendable bounds) for a set of recipient
 * pubkeys, by reading each one's profile lud16 and fetching their LNURL endpoint. Called only with the
 * (usually empty) set of authors who actually received zaps, so a board with no zaps does zero LNURL
 * HTTP. The map feeds zap-receipt validation; a recipient with no resolvable anchor simply yields no
 * trusted total (fail-closed).
 */
export function useLnurlAnchors(pubkeys: string[]): Map<string, LnurlPayMeta> {
  const { ndk } = useNDK();
  const [anchors, setAnchors] = useState<Map<string, LnurlPayMeta>>(EMPTY);
  const key = pubkeys.join(",");

  useEffect(() => {
    if (!ndk || pubkeys.length === 0) {
      setAnchors(EMPTY);
      return;
    }
    let active = true;
    void (async () => {
      const next = new Map<string, LnurlPayMeta>();
      await Promise.all(
        pubkeys.map(async (pubkey) => {
          try {
            const profile = await ndk.getUser({ pubkey }).fetchProfile();
            const lud16 = typeof profile?.lud16 === "string" ? profile.lud16 : null;
            if (!lud16) return;
            const meta = await resolveLnurlPay(lud16);
            if (meta) next.set(pubkey, meta);
          } catch {
            // unresolved anchor: this recipient's zaps stay untrusted (0)
          }
        }),
      );
      if (active) setAnchors(next);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndk, key]);

  return anchors;
}
