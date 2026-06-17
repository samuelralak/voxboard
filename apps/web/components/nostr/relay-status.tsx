"use client";

import { useEffect, useState } from "react";
import { useNDK } from "@nostr-dev-kit/react";

interface RelayInfo {
  host: string;
  connected: boolean;
}

/**
 * A quiet indicator of how many of the app's relays are connected, and which. It reads the MAIN NDK pool
 * (the default relay set, plus any board relays), not the outbox pool, so it reflects the stable set the
 * app reads boards from rather than the churn of per-author outbox connections. Hovering lists each relay
 * and its state, so a transient "3/4" is legible instead of alarming.
 */
export function RelayStatus() {
  const { ndk } = useNDK();
  const [relays, setRelays] = useState<RelayInfo[]>([]);

  useEffect(() => {
    if (!ndk) return;
    const tick = () => {
      const pool = ndk.pool;
      if (!pool) {
        setRelays([]);
        return;
      }
      const connected = new Set(pool.connectedRelays().map((r) => r.url));
      setRelays(
        [...pool.relays.values()].map((r) => ({
          host: r.url.replace(/^wss?:\/\//, "").replace(/\/$/, ""),
          connected: connected.has(r.url),
        })),
      );
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [ndk]);

  const connectedCount = relays.filter((r) => r.connected).length;
  const online = connectedCount > 0;
  const title = relays.length
    ? relays.map((r) => `${r.connected ? "●" : "○"} ${r.host}`).join("\n")
    : "No relays";

  return (
    <span
      role="status"
      title={title}
      aria-label={
        online ? `Connected to ${connectedCount} of ${relays.length} relays` : "Disconnected from relays"
      }
      className="inline-flex items-center gap-2 font-mono text-xs tabular-nums text-muted"
    >
      <span
        className={online ? "size-2 rounded-full bg-status-implemented" : "size-2 rounded-full bg-status-declined"}
        aria-hidden
      />
      {online ? `${connectedCount}/${relays.length} relays connected` : "Offline"}
    </span>
  );
}
