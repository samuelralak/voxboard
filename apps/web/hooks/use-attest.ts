"use client";

import { useCallback } from "react";
import { useNDK } from "@nostr-dev-kit/react";
import { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import { buildHttpAuth, sha256Hex } from "@voxboard/protocol";

// The attestation service base URL. When unset, attestation isn't wired in this deployment and the hook is
// a no-op (discover then falls back per its fail mode). NEXT_PUBLIC_ so it's available in the browser.
const ATTESTATION_URL = (process.env.NEXT_PUBLIC_ATTESTATION_URL ?? "").replace(/\/+$/, "");

/**
 * Request platform attestation for a board the user just created or edited.
 *
 * FIRE-AND-FORGET: the board is already published; attestation is an additive side-effect that must NEVER
 * block or fail the create flow. It signs a NIP-98 (kind 27235) token with the user's key, BOUND to the
 * request body (the coordinate) via the payload hash, so the token can't be replayed against another board.
 * The service independently fetches the board from relays, checks conformance + ownership, then signs the
 * platform label + set. A no-op when the service isn't configured or the user isn't logged in.
 *
 * If the request misses (e.g. the board hasn't propagated to the service's relays yet), the board still
 * works by direct link; re-saving the board re-fires this and the service is idempotent, so it self-heals.
 */
export function useAttest() {
  const { ndk } = useNDK();
  return useCallback(
    async (coordinate: string): Promise<void> => {
      if (!ATTESTATION_URL || !ndk?.signer) return;
      const url = `${ATTESTATION_URL}/v1/attest`;
      const body = JSON.stringify({ coordinate });

      const template = buildHttpAuth({ url, method: "POST", payload: sha256Hex(body) });
      const auth = new NDKEvent(ndk, {
        kind: template.kind as NDKKind,
        created_at: template.created_at,
        tags: template.tags,
        content: template.content,
      });
      await auth.sign(); // signs with the user's key; this token is sent to the service, never to relays
      // UTF-8-safe base64 (matches the server's Buffer.from(token,'base64').toString('utf8') decode), so a
      // non-ASCII char anywhere in the event can't make btoa throw.
      const bytes = new TextEncoder().encode(JSON.stringify(auth.rawEvent()));
      const token = btoa(String.fromCharCode(...bytes));

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Nostr ${token}` },
        body,
      });
      if (!res.ok) {
        // surface for diagnostics without breaking the create flow (the caller also catches)
        console.warn(`attestation request failed (${res.status})`, await res.text().catch(() => ""));
      }
    },
    [ndk],
  );
}
