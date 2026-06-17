/**
 * Server-side platform attestation config (the strict-allowlist noise filter). See docs/ATTESTATION.md.
 *
 * SERVER-ONLY: ATTESTATION_PUBKEY has NO NEXT_PUBLIC_ prefix, so it is undefined in the browser bundle.
 * Client code must NOT import this — it resolves the issuer pubkey at runtime from NIP-05
 * (/.well-known/nostr.json?name=_), which is the rotation anchor. This module feeds the NIP-05 route and
 * the SSR discover filter (fetchDiscoverBoards). Pairing the env-derived pubkey here with the NIP-05
 * publish keeps one source of truth: the deployment's own ATTESTATION_PUBKEY.
 */

import "server-only";

import { attestationNamespace, isHex64 } from "@voxboard/protocol";

/** The platform issuer pubkey (hex) for THIS deployment, or null when attestation isn't configured. */
export function issuerPubkey(): string | null {
  const value = (process.env.ATTESTATION_PUBKEY ?? "").trim().toLowerCase();
  return isHex64(value) ? value : null;
}

/**
 * The env-scoped attestation namespace for THIS deployment. Driven by ATTESTATION_ENV (set to "staging"
 * on a staging app) and falling back to NODE_ENV, so production uses the bare base and any other env
 * appends `.<env>` — the read-time pin that stops a staging issuer key from validating in production.
 * The signer service MUST derive its namespace from the same env signal.
 */
export function attestationNs(): string {
  return attestationNamespace(process.env.ATTESTATION_ENV ?? process.env.NODE_ENV);
}

/** The reserved NIP-05 name under which the issuer pubkey is published (voxboard.space/...?name=_). */
export const ISSUER_NIP05_NAME = "_";
