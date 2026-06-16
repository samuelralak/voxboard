import "client-only";

import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { KIND, decodeInvoice } from "@voxboard/protocol";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { resolveLnurlPay } from "./lnurl";

/** A user-facing zap failure (message is safe to display). */
export class ZapError extends Error {}

export interface ZapInvoice {
  /** the bolt11 invoice to pay */
  pr: string;
  amountMsat: bigint;
  paymentHash: string;
}

export interface ZapRequestTarget {
  /** the idea (or reply) event id being zapped */
  eventId: string;
  recipientPubkey: string;
  /** the recipient's lightning address (from their profile) */
  lud16: string;
}

/**
 * The rail-independent head of a zap: resolve the recipient's LNURL, clamp the amount to their bounds,
 * build + SIGN the kind-9734 zap request with the user's Nostr signer (never published to relays — it
 * travels in the LNURL callback), call the callback, and decode + verify the returned invoice. The
 * invoice amount is checked against what we asked for; a server-echoed amount is never trusted. The
 * caller then pays `pr` with their own wallet (WebLN / manual) — no key ever reaches a server.
 */
export async function requestZapInvoice(
  ndk: NDK,
  target: ZapRequestTarget,
  sats: number,
  comment?: string,
): Promise<ZapInvoice> {
  if (!ndk.signer) throw new ZapError("Log in to zap.");
  if (!Number.isFinite(sats) || sats < 1) throw new ZapError("Enter a valid amount.");

  const meta = await resolveLnurlPay(target.lud16);
  if (!meta) throw new ZapError("This account can’t receive zaps yet.");

  const amountMsat = BigInt(Math.floor(sats)) * BigInt(1000);
  if (amountMsat < meta.minSendableMsat || amountMsat > meta.maxSendableMsat) {
    throw new ZapError("That amount is outside this recipient’s limits.");
  }

  // Build + sign the 9734. NIP-57: a single `relays` tag carrying the relay URLs, plus amount/p/e/k.
  const request = new NDKEvent(ndk, {
    kind: KIND.ZapRequest,
    created_at: Math.floor(Date.now() / 1000),
    content: comment?.trim() ?? "",
    tags: [
      ["relays", ...DEFAULT_RELAYS.slice(0, 4)],
      ["amount", String(amountMsat)],
      ["p", target.recipientPubkey],
      ["e", target.eventId],
      ["k", String(KIND.Comment)],
    ],
  });
  await request.sign();
  const nostr = JSON.stringify(request.rawEvent());

  const url = new URL(meta.callback);
  url.searchParams.set("amount", String(amountMsat));
  url.searchParams.set("nostr", nostr);

  let json: { status?: string; reason?: string; pr?: string };
  try {
    const res = await fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(8000) });
    json = (await res.json()) as typeof json;
  } catch {
    throw new ZapError("Couldn’t reach the Lightning provider.");
  }
  if (!json || json.status === "ERROR" || typeof json.pr !== "string") {
    throw new ZapError(json?.reason || "The Lightning provider rejected the request.");
  }

  // Never trust the server-echoed amount: decode the invoice and require the amount we asked for.
  const decoded = decodeInvoice(json.pr);
  if (!decoded) throw new ZapError("The provider returned an unreadable invoice.");
  if (decoded.amountMsat !== amountMsat) throw new ZapError("The invoice amount didn’t match the request.");

  return { pr: json.pr, amountMsat, paymentHash: decoded.paymentHash };
}

interface WebLNProvider {
  enable: () => Promise<void>;
  sendPayment: (pr: string) => Promise<{ preimage: string }>;
}

/**
 * Pay a bolt11 with a WebLN provider if one is present (Alby etc.). Returns true if paid, false if no
 * WebLN is available (the caller falls back to the manual invoice). The Lightning key stays in the
 * wallet/extension — Voxboard never sees it.
 */
export async function payWithWebLN(pr: string): Promise<boolean> {
  const webln = (globalThis as { webln?: WebLNProvider }).webln;
  if (!webln) return false;
  await webln.enable();
  await webln.sendPayment(pr);
  return true;
}
