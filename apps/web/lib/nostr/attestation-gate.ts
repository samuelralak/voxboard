import "server-only";

import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";
import {
  ATTESTATION,
  decideAllowlist,
  isSafeRelayUrl,
  selectLatestAttestationSet,
  validateNostrEvent,
  type AllowlistDecision,
  type NostrEvent,
} from "@voxboard/protocol";
import { attestationNs, issuerPubkey } from "@/lib/attestation";
import { DEFAULT_RELAYS } from "./relays";

/**
 * Resolve the platform allowlist that gates production discover. The SSR side RE-VERIFIES the signed set
 * (envelope + Schnorr via verifyEvent, then issuer + env-namespace pin via the shared
 * selectLatestAttestationSet), so trust rests on the platform signature, not on any relay being honest.
 * The fail mode (last-known-good on a blind read; show-nothing on a verifiably-empty set) is the pure
 * decideAllowlist policy in @voxboard/protocol.
 *
 * `cached` is a per-instance in-memory store of the last LIVE allowlist. It serves two roles: a short TTL
 * skip (avoid re-fetching + re-verifying the set on every discover render) and the blind-read fallback.
 */
const ALLOWLIST_TTL_MS = 30_000;
// Keyed by (issuer + namespace + relay set), so a different deployment/caller never reuses another's
// allowlist; the TTL skip and the blind-read fallback both require a key match.
let cached: { coords: Set<string>; at: number; key: string } | null = null;

/** Clear the per-instance allowlist cache. Test-only seam so cases don't leak the cache into each other. */
export function __resetAllowlistCacheForTest(): void {
  cached = null;
}

export async function fetchAllowlist(
  relays: readonly string[] = [],
  pool?: SimplePool,
): Promise<AllowlistDecision> {
  const issuer = issuerPubkey();
  if (!issuer) {
    return decideAllowlist({ configured: false, latestCoords: null, responded: 0, cache: null });
  }

  const ns = attestationNs();
  // SSRF-gate every relay (naddr hints are attacker-controlled); never dial a loopback/private/IP-literal host.
  const relaySet = (relays.length > 0 ? [...relays] : [...DEFAULT_RELAYS]).filter(isSafeRelayUrl);
  const key = `${issuer}|${ns}|${[...relaySet].sort().join(",")}`;
  const fallback = cached && cached.key === key ? cached.coords : null; // last-known-good for THIS key only

  // TTL skip: within the window, reuse the last live allowlist for this key without a relay round-trip
  // (discover is best-effort; a new attestation / revoke propagates to discover within the TTL).
  if (cached && cached.key === key && Date.now() - cached.at < ALLOWLIST_TTL_MS) {
    return { coords: cached.coords, source: "cache" };
  }
  if (relaySet.length === 0) {
    return decideAllowlist({ configured: true, latestCoords: null, responded: 0, cache: fallback });
  }

  const ownPool = pool ?? new SimplePool();
  try {
    const raw = await ownPool.querySync(
      relaySet,
      { kinds: [ATTESTATION.setKind], authors: [issuer], "#d": [ATTESTATION.setIdentifier] },
      { maxWait: 4000 },
    );
    // envelope + Schnorr first, then the shared issuer/namespace pin + latest-wins selection
    const verifiedSets = raw
      .map((e) => validateNostrEvent(e))
      .filter((e): e is NostrEvent => e !== null && verifyEvent(e as NostrEvent & { sig: string }));
    const latest = selectLatestAttestationSet(verifiedSets, issuer, ns);

    // reachability over the status map values (the pool entries are the relays we dialed); 0 = blind read
    const status = ownPool.listConnectionStatus();
    let responded = 0;
    for (const connected of status.values()) if (connected) responded += 1;

    const decision = decideAllowlist({
      configured: true,
      latestCoords: latest ? latest.coordinates : null,
      responded,
      cache: fallback,
    });
    if (decision.source === "live" && decision.coords) cached = { coords: decision.coords, at: Date.now(), key };
    return decision;
  } catch {
    // unexpected fetch error: fall back to last-known-good for this key (or fail open if none yet)
    return decideAllowlist({ configured: true, latestCoords: null, responded: 0, cache: fallback });
  } finally {
    if (!pool) ownPool.close(relaySet); // only close a pool we own (a shared pool is the caller's to close)
  }
}
