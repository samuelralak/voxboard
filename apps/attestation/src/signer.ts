/**
 * The platform attestation signer = Switchboard's IssuerIdentity + Events::Sign, ported to TypeScript.
 *
 * Holds the platform issuer private key behind a single closure: it is read ONCE from the environment,
 * decoded to bytes, and never logged, never returned, never stored on a field. Everything else in the
 * service signs through `sign()`. This is the platform's OWN key (never a user key) — an attestation is
 * the platform vouching for a board, e-tagging that exact board event.
 *
 * Read-side trust in the issuer key is NIP-05 (the pubkey is published at
 * voxboard.space/.well-known/nostr.json), so the key can rotate without a client release. The optional
 * ATTESTATION_PUBKEY here is only a fail-closed assertion that the configured key derives the expected
 * pubkey — the signer can never sign under one key while NIP-05 advertises another.
 */

import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { hexToBytes } from "@noble/hashes/utils";
import type { EventTemplate, NostrEvent } from "@voxboard/protocol";

export interface Signer {
  /** the issuer public key (hex). Safe to expose — it is published via NIP-05. */
  readonly issuerPubkey: string;
  /** sign a built template into a full signed Nostr event (adds id + pubkey + sig). */
  sign(template: EventTemplate): NostrEvent;
}

/** The slice of the environment the signer reads. Defaults to process.env in production. */
export interface SignerEnv {
  ATTESTATION_PRIVATE_KEY?: string;
  /** optional fail-closed assertion that the key derives this pubkey (NOT a different-issuer override) */
  ATTESTATION_PUBKEY?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Decode a 64-hex or `nsec1...` private key into raw bytes. Throws on anything malformed (fail closed). */
function decodeSecret(raw: string): Uint8Array {
  const value = raw.trim();
  if (HEX64.test(value.toLowerCase())) return hexToBytes(value.toLowerCase());
  if (value.startsWith("nsec1")) {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nsec") throw new Error("ATTESTATION_PRIVATE_KEY: bech32 is not an nsec");
    return decoded.data;
  }
  throw new Error("ATTESTATION_PRIVATE_KEY must be a 64-char hex string or an nsec1 key");
}

/**
 * Build the signer from the environment. The private key is captured ONLY in the `sign` closure below;
 * no field or accessor ever exposes it. Throws if the key is missing/malformed, or if ATTESTATION_PUBKEY
 * is set but doesn't match the key — both are fatal misconfigurations, so we fail closed at startup.
 */
export function createSigner(env: SignerEnv = process.env): Signer {
  const rawKey = env.ATTESTATION_PRIVATE_KEY;
  if (!rawKey || rawKey.trim() === "") throw new Error("ATTESTATION_PRIVATE_KEY is not set");

  const secret = decodeSecret(rawKey);
  const issuerPubkey = getPublicKey(secret);

  const override = env.ATTESTATION_PUBKEY?.trim().toLowerCase();
  if (override && override !== issuerPubkey) {
    throw new Error("ATTESTATION_PUBKEY does not match the public key derived from ATTESTATION_PRIVATE_KEY");
  }

  return {
    issuerPubkey,
    sign(template: EventTemplate): NostrEvent {
      const signed = finalizeEvent(template, secret) as NostrEvent;
      // Belt-and-suspenders: never emit an event we can't verify ourselves (catches a malformed template).
      if (!verifyEvent(signed)) throw new Error("signer produced an event that fails verification");
      return signed;
    },
  };
}
