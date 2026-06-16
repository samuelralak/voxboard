/**
 * NIP-57 zap RECEIPT (kind 9735) validation — the security boundary for an idea's sats total. A relay
 * or attacker can serve forged/inflated receipts to fake a total and game ranking, so a receipt's
 * amount is trusted ONLY after an ordered gate passes. The amount is read from the decoded bolt11
 * invoice and nowhere else. Pure + framework-agnostic so the indexer and the web client run identical
 * code. The recipient's LNURL `nostrPubkey` (the trust anchor) is supplied by the caller, never fetched
 * here. See docs/PROTOCOL.md and the M4 zap spec.
 */

import { verifyEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { KIND } from "./kinds";
import { parseCoordinate } from "./coords";
import { decodeInvoice } from "./bolt11";
import { getTag, getTagValue, getTags, nostrEventSchema, type NostrEvent } from "./event";

/** millisats per sat; the SINGLE conversion boundary (all internal math is msat BigInt). BigInt() (not
 *  a 1000n literal) so the shared source compiles under consumers targeting < ES2020. */
export const ZAP_SAT = BigInt(1000);

// ---------------------------------------------------------------------------
// Parse (structural only — no trust decision)
// ---------------------------------------------------------------------------

export interface ParsedZapReceipt {
  id: string;
  /** the event's signing key — the LNURL server's key, the trust-anchor CANDIDATE */
  receiptPubkey: string;
  /** outer `p` (recipient), lowercased */
  recipient: string;
  /** outer `e` (zapped event id) */
  targetEventId: string | null;
  /** outer `a` (zapped address) */
  targetCoord: string | null;
  bolt11: string;
  /** the `description` tag value AS RECEIVED (one %-decode only); hashed verbatim, never re-serialized */
  descriptionRaw: string;
  /** the embedded, schema-valid kind-9734 zap request */
  request: NostrEvent;
  createdAt: number;
  raw: NostrEvent;
}

function decodeDescription(value: string): string | null {
  if (!value.startsWith("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Shape-check a kind-9735 receipt: extract everything validateZapReceipt needs, or null if malformed. */
export function parseZapReceipt(event: NostrEvent): ParsedZapReceipt | null {
  if (event.kind !== KIND.ZapReceipt) return null;
  if (!nostrEventSchema.safeParse(event).success) return null;

  const bolt11 = getTagValue(event.tags, "bolt11");
  if (!bolt11) return null;

  const descTag = getTagValue(event.tags, "description");
  if (descTag === undefined) return null;
  const descriptionRaw = decodeDescription(descTag);
  if (descriptionRaw === null) return null;

  let requestJson: unknown;
  try {
    requestJson = JSON.parse(descriptionRaw);
  } catch {
    return null;
  }
  const request = nostrEventSchema.safeParse(requestJson);
  if (!request.success || request.data.kind !== KIND.ZapRequest) return null;

  const recipient = getTagValue(event.tags, "p")?.toLowerCase();
  if (!recipient) return null;

  return {
    id: event.id,
    receiptPubkey: event.pubkey.toLowerCase(),
    recipient,
    targetEventId: getTagValue(event.tags, "e") ?? null,
    targetCoord: getTagValue(event.tags, "a") ?? null,
    bolt11,
    descriptionRaw,
    request: request.data,
    createdAt: event.created_at,
    raw: event,
  };
}

// ---------------------------------------------------------------------------
// Validate (the ordered gate)
// ---------------------------------------------------------------------------

export interface ZapExpectation {
  /** the event id (idea or reply) being credited */
  targetEventId?: string;
  /** OR a board coordinate for a board-level zap */
  targetCoord?: string;
  /** the pubkey being credited (idea/reply author) */
  recipientPubkey: string;
  /** the recipient's OWN LNURL `nostrPubkey` — the trust anchor, resolved by the caller */
  lnurlNostrPubkey?: string;
  /** the recipient's bech32 lnurl, for the 9734.lnurl cross-check (optional) */
  lnurl?: string;
  /** sendable bounds (msat) from the recipient's LNURL metadata (optional) */
  minSendableMsat?: bigint;
  maxSendableMsat?: bigint;
}

export type ZapReject =
  | "kind"
  | "receipt-sig"
  | "no-anchor"
  | "anchor-mismatch"
  | "request-sig"
  | "request-coherence"
  | "bad-invoice"
  | "description-binding"
  | "amount-tag-mismatch"
  | "target-mismatch"
  | "recipient-mismatch"
  | "lnurl-mismatch"
  | "out-of-bounds";

export interface ValidatedZap {
  ok: true;
  receiptId: string;
  /** primary, cross-idea dedupe key */
  paymentHash: string;
  /** authoritative amount, from the bolt11 invoice only */
  amountMsat: bigint;
  recipient: string;
  targetEventId: string | null;
  targetCoord: string | null;
  /** the SIGNED 9734 author (never the advisory `P` tag); used for self-zap detection */
  senderPubkey: string;
  createdAt: number;
}

export type ZapResult = ValidatedZap | { ok: false; reason: ZapReject };

const reject = (reason: ZapReject): { ok: false; reason: ZapReject } => ({ ok: false, reason });

/**
 * The single ordered gate. A receipt's amount is trustworthy only if EVERY check passes; each rejects
 * on first failure with a typed reason (for telemetry + tests). Pure and deterministic.
 */
export function validateZapReceipt(receipt: ParsedZapReceipt, expected: ZapExpectation): ZapResult {
  // 1. kind
  if (receipt.raw.kind !== KIND.ZapReceipt) return reject("kind");

  // 2. receipt signature — the decoder/parsers verify nothing; this is mandatory.
  if (!verifyEvent(receipt.raw)) return reject("receipt-sig");

  // 3. anchor — the load-bearing check: the receipt MUST be signed by the recipient's own LNURL key.
  //    No anchor => fail closed (caller decides degraded display); wrong key => forgery.
  if (!expected.lnurlNostrPubkey) return reject("no-anchor");
  if (receipt.receiptPubkey !== expected.lnurlNostrPubkey.toLowerCase()) return reject("anchor-mismatch");

  // 4. embedded 9734 signature — must independently verify.
  if (!verifyEvent(receipt.request)) return reject("request-sig");

  // 5. embedded 9734 coherence (NIP-57 Appendix D).
  const req = receipt.request;
  const reqP = getTags(req.tags, "p");
  const reqE = getTags(req.tags, "e");
  const reqA = getTags(req.tags, "a");
  if (reqP.length !== 1) return reject("request-coherence");
  if (reqE.length > 1 || reqA.length > 1) return reject("request-coherence");
  if (getTags(req.tags, "P").length > 1) return reject("request-coherence");
  if (!getTag(req.tags, "relays")) return reject("request-coherence");
  const reqACoord = reqA[0]?.[1];
  if (reqACoord !== undefined && parseCoordinate(reqACoord) === null) return reject("request-coherence");

  // 6. invoice — authoritative amount + dedupe keys (amountless/garbage rejected here).
  const invoice = decodeInvoice(receipt.bolt11);
  if (!invoice) return reject("bad-invoice");

  // 7. description binding — sha256 of the RAW description bytes pins the invoice to THIS exact 9734
  //    (and thus its e/a/p). This is what stops re-wrapping a real invoice onto another idea.
  if (!invoice.descriptionHash) return reject("description-binding");
  const descHash = bytesToHex(sha256(utf8ToBytes(receipt.descriptionRaw)));
  if (descHash !== invoice.descriptionHash) return reject("description-binding");

  // 8. the 9734 amount tag, if present, must equal the decoded invoice amount.
  const reqAmount = getTagValue(req.tags, "amount");
  if (reqAmount !== undefined && reqAmount !== String(invoice.amountMsat)) return reject("amount-tag-mismatch");

  // 9. target — credit by the hash-bound 9734's e/a, with the outer receipt tag required to agree.
  const reqEId = reqE[0]?.[1];
  const reqAId = reqA[0]?.[1];
  if (expected.targetEventId) {
    if (reqEId !== expected.targetEventId || receipt.targetEventId !== expected.targetEventId) {
      return reject("target-mismatch");
    }
  } else if (expected.targetCoord) {
    // Crediting by coordinate: also forbid any stray outer/embedded `e` tag, so an unvalidated event id
    // can never flow into the result and key the credit under the wrong (or a phantom) event id.
    if (
      reqAId !== expected.targetCoord ||
      receipt.targetCoord !== expected.targetCoord ||
      receipt.targetEventId !== null ||
      reqEId !== undefined
    ) {
      return reject("target-mismatch");
    }
  } else {
    return reject("target-mismatch"); // the caller must name a target
  }

  // 10. recipient — the 9734 p and the outer receipt p must both equal the credited pubkey.
  const want = expected.recipientPubkey.toLowerCase();
  if (reqP[0]?.[1]?.toLowerCase() !== want || receipt.recipient !== want) return reject("recipient-mismatch");

  // 11. lnurl cross-check (when both known).
  const reqLnurl = getTagValue(req.tags, "lnurl");
  if (reqLnurl !== undefined && expected.lnurl !== undefined && reqLnurl !== expected.lnurl) {
    return reject("lnurl-mismatch");
  }

  // 12. amount bounds (when known).
  if (expected.minSendableMsat !== undefined && invoice.amountMsat < expected.minSendableMsat) {
    return reject("out-of-bounds");
  }
  if (expected.maxSendableMsat !== undefined && invoice.amountMsat > expected.maxSendableMsat) {
    return reject("out-of-bounds");
  }

  return {
    ok: true,
    receiptId: receipt.id,
    paymentHash: invoice.paymentHash,
    amountMsat: invoice.amountMsat,
    recipient: want,
    targetEventId: receipt.targetEventId,
    targetCoord: receipt.targetCoord,
    senderPubkey: req.pubkey.toLowerCase(),
    createdAt: receipt.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Totals (validated + deduped)
// ---------------------------------------------------------------------------

export interface ZapTotal {
  /** validated, deduped sat total (floor of msat/1000) — the only number UI/ranking may use */
  sats: number;
  msat: bigint;
  /** distinct validated payments */
  zapCount: number;
  /** distinct sender pubkeys (the signed 9734 authors) */
  senders: Set<string>;
}

export interface ZapTotalsOptions {
  /** drop zaps where the sender is the recipient (for ranking); off by default (display shows them) */
  excludeSelfZaps?: boolean;
}

const EMPTY_TOTAL = (): { msat: bigint; senders: Set<string>; count: number } => ({
  msat: BigInt(0),
  senders: new Set<string>(),
  count: 0,
});

/**
 * Validated, deduped zap totals per target. Global two-key dedupe: a payment_hash credits exactly one
 * target (cross-idea), and a receipt id counts once (across relay copies). Only receipts that pass the
 * full gate contribute; everything else is silently dropped (no attacker-controllable number surfaces).
 */
export function zapTotalsByTarget(
  receipts: NostrEvent[],
  resolveExpectation: (receipt: ParsedZapReceipt) => ZapExpectation | null,
  options: ZapTotalsOptions = {},
): Map<string, ZapTotal> {
  // Pass 1: validate, dedupe by receipt id (same receipt via many relays). Only validated zaps survive,
  // so a forged receipt never consumes a payment_hash slot and can't deny credit to a real one.
  const byReceiptId = new Map<string, ValidatedZap>();
  for (const raw of receipts) {
    const parsed = parseZapReceipt(raw);
    if (!parsed) continue;
    if (byReceiptId.has(parsed.id)) continue;
    const expectation = resolveExpectation(parsed);
    if (!expectation) continue;
    const result = validateZapReceipt(parsed, expectation);
    if (!result.ok) continue;
    if (options.excludeSelfZaps && result.senderPubkey === result.recipient) continue;
    byReceiptId.set(result.receiptId, result);
  }

  // Pass 2: a payment_hash credits exactly ONE zap. Pick the winner DETERMINISTICALLY (earliest
  // created_at, then lowest receipt id) so every client/indexer converges on the same target/total
  // regardless of relay-delivery order.
  const byPaymentHash = new Map<string, ValidatedZap>();
  for (const zap of byReceiptId.values()) {
    const prev = byPaymentHash.get(zap.paymentHash);
    if (
      !prev ||
      zap.createdAt < prev.createdAt ||
      (zap.createdAt === prev.createdAt && zap.receiptId < prev.receiptId)
    ) {
      byPaymentHash.set(zap.paymentHash, zap);
    }
  }

  // Pass 3: sum the surviving winners per target.
  const acc = new Map<string, ReturnType<typeof EMPTY_TOTAL>>();
  for (const zap of byPaymentHash.values()) {
    const key = zap.targetEventId ?? zap.targetCoord;
    if (!key) continue;
    const entry = acc.get(key) ?? EMPTY_TOTAL();
    entry.msat += zap.amountMsat;
    entry.count += 1;
    entry.senders.add(zap.senderPubkey);
    acc.set(key, entry);
  }

  const out = new Map<string, ZapTotal>();
  for (const [key, entry] of acc) {
    out.set(key, {
      sats: Number(entry.msat / ZAP_SAT), // single msat -> sat floor
      msat: entry.msat,
      zapCount: entry.count,
      senders: entry.senders,
    });
  }
  return out;
}
