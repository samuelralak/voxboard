"use client";

import { useEffect, useState } from "react";
import { useNDK } from "@nostr-dev-kit/react";

/**
 * A receding nostr-native chrome element (docs/DESIGN.md): a quiet indicator of how many relays are
 * currently connected. Doubles as an end-to-end proof that the NDK provider and outbox pool are live.
 */
export function RelayStatus() {
  const { ndk } = useNDK();
  const [connected, setConnected] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!ndk) return;
    const tick = () => {
      const pool = ndk.pool;
      setTotal(pool?.relays?.size ?? 0);
      setConnected(pool?.connectedRelays().length ?? 0);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [ndk]);

  const online = connected > 0;
  return (
    <span
      role="status"
      aria-label={online ? `Connected to ${connected} of ${total} relays` : "Disconnected from relays"}
      className="inline-flex items-center gap-2 font-mono text-xs tabular-nums text-muted"
    >
      <span
        className={online ? "size-2 rounded-full bg-status-implemented" : "size-2 rounded-full bg-status-declined"}
        aria-hidden
      />
      {online ? `${connected}/${total} relays connected` : "Offline"}
    </span>
  );
}
