/**
 * Runtime config for the attestation service, read once from the environment. All values fail closed
 * (empty/malformed inputs are dropped, not trusted). The signer + relays are configured elsewhere
 * (signer.ts, relays.ts); this holds the operator allow-list and the public-URL base used for NIP-98.
 */

import { attestationNamespace } from "@voxboard/protocol";

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Operator pubkeys (hex) allowed to attest ANY board and to revoke. Comma-separated ATTESTATION_OPERATORS.
 * The automated owner-self-attest path does NOT need this (owners attest their own boards); operators are
 * for backfill/revoke and override.
 */
export function operatorPubkeys(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.ATTESTATION_OPERATORS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => HEX64.test(s)),
  );
}

/** The env-scoped attestation namespace for this deployment (must match the web app's). */
export function namespace(env: NodeJS.ProcessEnv = process.env): string {
  return attestationNamespace(env.ATTESTATION_ENV ?? env.NODE_ENV);
}

/**
 * The public base URL clients sign in their NIP-98 `u` tag (e.g. https://attestation.voxboard.space). When
 * set, the server reconstructs the expected request URL from it rather than trusting proxy headers blindly.
 */
export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.ATTESTATION_PUBLIC_URL?.trim();
  return raw ? raw : undefined;
}

/** The port to listen on (Fly injects PORT; default 8080). */
export function port(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PORT ?? 8080);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8080;
}

/** Allowed CORS origin for the browser create-hook. Default "*" (auth is in the body/header, not cookies). */
export function corsOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATTESTATION_ALLOWED_ORIGIN?.trim() || "*";
}
