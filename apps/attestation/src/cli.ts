/**
 * Operator CLI for the attestation service: sign a NIP-98 token with the OPERATOR key and POST it to the
 * privileged endpoints. Used for production moderation (revoke spam) and to bootstrap boards during rollout.
 *
 *   ATTESTATION_OPERATOR_KEY=<hex|nsec> ATTESTATION_URL=https://attestation.voxboard.space \
 *     npm -w @voxboard/attestation run cli -- attest 34550:<owner>:<slug>
 *     npm -w @voxboard/attestation run cli -- revoke 34550:<owner>:<slug> [<board-event-id>]
 *
 * The operator pubkey (derived from the key) MUST be in the server's ATTESTATION_OPERATORS allow-list. The
 * key is the operator's own key, never the platform issuer key (the service holds that).
 */

import { fileURLToPath } from "node:url";
import { buildHttpAuth, sha256Hex } from "@voxboard/protocol";
import { createSigner, type Signer } from "./signer";

/** Build the `Authorization: Nostr <base64>` header for a POST body, signed by the operator (payload-bound). */
export function operatorAuthHeader(signer: Signer, url: string, body: string): string {
  const token = signer.sign(buildHttpAuth({ url, method: "POST", payload: sha256Hex(body) }));
  return "Nostr " + Buffer.from(JSON.stringify(token)).toString("base64");
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

export async function run(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const [action, coordinate, eventId] = argv;
  if ((action !== "attest" && action !== "revoke") || !coordinate) {
    fail("usage: cli <attest|revoke> <34550:owner:slug> [eventId]\nenv: ATTESTATION_OPERATOR_KEY, ATTESTATION_URL");
  }

  const baseUrl = (env.ATTESTATION_URL ?? env.ATTESTATION_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) fail("ATTESTATION_URL (or ATTESTATION_PUBLIC_URL) is not set");
  const key = env.ATTESTATION_OPERATOR_KEY;
  if (!key) fail("ATTESTATION_OPERATOR_KEY is not set");

  const signer = createSigner({ ATTESTATION_PRIVATE_KEY: key });
  const url = baseUrl + (action === "attest" ? "/v1/attest" : "/v1/revoke");
  const body = JSON.stringify(action === "revoke" && eventId ? { coordinate, eventId } : { coordinate });
  const auth = operatorAuthHeader(signer, url, body);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body,
  });
  const text = await res.text();
  console.log(`${res.status} ${text}`);
  if (!res.ok) process.exit(1);
}

// run only when executed directly (tsx src/cli.ts ...), never when imported by a test
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void run(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
