/**
 * The attestation service's relay client: a thin wrapper over nostr-tools SimplePool that mirrors the
 * web app's server-side pattern (apps/web/lib/nostr/server.ts) — an ephemeral pool per operation,
 * `querySync` with a maxWait, validate + verify at the boundary, `close()` in a finally.
 *
 * Everything here is behind the `RelayClient` interface so attest/issue take it as a dependency and can
 * be unit-tested against an in-memory fake (no live relays). The real client validates every queried
 * event (envelope shape via validateNostrEvent) AND verifies its Schnorr signature (nostr-tools
 * verifyEvent) before returning it — untrusted relay data is never handed upward unverified.
 */

import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { isSafeRelayUrl, validateNostrEvent, type NostrEvent } from "@voxboard/protocol";

/** Query timeouts mirror server.ts: 4s for primary metadata. */
export const PRIMARY_MAX_WAIT = 4000;

/**
 * Default relays. MUST overlap the web app's DEFAULT_RELAYS (apps/web/lib/nostr/relays.ts) so the
 * issuer's set + labels land where discover reads them. Override per-deployment with ATTESTATION_RELAYS.
 */
export const DEFAULT_ATTESTATION_RELAYS = [
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://purplepag.es",
] as const;

/** Resolve the relay set from env (comma-separated ATTESTATION_RELAYS), SSRF-gated. Fails closed. */
export function configuredRelays(env: { ATTESTATION_RELAYS?: string } = process.env): string[] {
  const raw = (env.ATTESTATION_RELAYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = raw.length > 0 ? raw : [...DEFAULT_ATTESTATION_RELAYS];
  const safe = candidates.filter(isSafeRelayUrl);
  if (safe.length === 0) throw new Error("no safe relays in ATTESTATION_RELAYS");
  return safe;
}

export interface PublishResult {
  /** relays that accepted the event */
  ok: number;
  /** relays that rejected or errored */
  failed: number;
}

export interface QueryResult {
  /** envelope-valid, signature-verified events matching the filter */
  events: NostrEvent[];
  /**
   * how many of the configured relays were reachable for this query. `0` means a BLIND read — every relay
   * was unreachable — which `querySync` alone cannot signal (it resolves with `[]` on total failure just as
   * it does on a genuine empty). The issuer write path uses this to refuse recomputing the allowlist on a
   * blind read, so a transient total outage can never publish a shrunken set that supersedes the real one.
   */
  responded: number;
}

export interface RelayClient {
  /** Query relays, returning only envelope-valid, signature-verified events plus a reachability count. */
  query(filter: Filter, maxWait?: number): Promise<QueryResult>;
  /** Broadcast a signed event to every relay; resolves once each relay has accepted or failed. */
  publish(event: NostrEvent): Promise<PublishResult>;
  /** Close all sockets. Always call in a finally (or use withRelayClient). */
  close(): void;
}

/** A real relay client backed by one ephemeral SimplePool for the lifetime of an operation. */
export function createRelayClient(relays: string[]): RelayClient {
  const pool = new SimplePool();
  return {
    async query(filter, maxWait = PRIMARY_MAX_WAIT): Promise<QueryResult> {
      const raw = await pool.querySync(relays, filter, { maxWait });
      const events: NostrEvent[] = [];
      for (const candidate of raw) {
        const event = validateNostrEvent(candidate);
        // verify the Schnorr sig at the boundary (mirrors the indexer); drop anything unverifiable
        if (event && verifyEvent(event as NostrEvent & { sig: string })) events.push(event);
      }
      // a relay with an open connection after the query was reachable; 0 reachable = a blind read.
      const status = pool.listConnectionStatus();
      let responded = 0;
      for (const relay of relays) if (status.get(relay)) responded += 1;
      return { events, responded };
    },
    async publish(event): Promise<PublishResult> {
      const settled = await Promise.allSettled(
        pool.publish(relays, event as Parameters<SimplePool["publish"]>[1]),
      );
      const ok = settled.filter((r) => r.status === "fulfilled").length;
      return { ok, failed: settled.length - ok };
    },
    close(): void {
      pool.close(relays);
    },
  };
}

/**
 * Run `fn` with a fresh relay client, guaranteeing `close()` even on throw. Callers (the Phase 4 endpoint,
 * backfill/revoke tooling) should drive every operation through this rather than the raw factory, so a
 * forgotten finally can't leak SimplePool sockets.
 */
export async function withRelayClient<T>(relays: string[], fn: (client: RelayClient) => Promise<T>): Promise<T> {
  const client = createRelayClient(relays);
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
