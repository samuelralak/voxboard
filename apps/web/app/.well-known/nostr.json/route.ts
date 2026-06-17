/**
 * NIP-05 endpoint for handles Voxboard hosts on its own domain. Per NIP-05: respond to `?name=`,
 * return lowercase hex pubkeys in `names`, optional `relays`, set CORS `*`, and never redirect.
 *
 * It also publishes the platform ATTESTATION issuer pubkey under the reserved name `_` (the domain's own
 * identity). This is the rotation anchor: clients resolve which key signs the strict-allowlist set/labels
 * from HERE at runtime, never from a hardcoded bundle constant, so the key can rotate via a one-file edit
 * (update ATTESTATION_PUBKEY + redeploy + re-sign). See docs/ATTESTATION.md.
 *
 * The handle registry is otherwise empty until orgs/boards claim names; the shape is ready to populate.
 */

import { issuerPubkey, ISSUER_NIP05_NAME } from "@/lib/attestation";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";

const NAMES: Record<string, string> = {};
const RELAYS: Record<string, string[]> = {};

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
} as const;

/** Merge the env-configured attestation issuer into the static registry (server-evaluated per request). */
function registry(): { names: Record<string, string>; relays: Record<string, string[]> } {
  const issuer = issuerPubkey();
  if (!issuer) return { names: { ...NAMES }, relays: { ...RELAYS } };
  return {
    names: { ...NAMES, [ISSUER_NIP05_NAME]: issuer },
    // advertise where the issuer's set/labels live so clients can find them without guessing
    relays: { ...RELAYS, [issuer]: [...DEFAULT_RELAYS] },
  };
}

export async function GET(request: Request): Promise<Response> {
  const { names, relays } = registry();
  const name = new URL(request.url).searchParams.get("name");

  if (name === null) {
    return Response.json({ names, relays }, { headers: HEADERS });
  }

  const local = name.toLowerCase();
  const pubkey = names[local];
  if (!pubkey) {
    return Response.json({ names: {} }, { headers: HEADERS });
  }

  const pubkeyRelays = relays[pubkey];
  return Response.json(
    { names: { [local]: pubkey }, ...(pubkeyRelays ? { relays: { [pubkey]: pubkeyRelays } } : {}) },
    { headers: HEADERS },
  );
}
