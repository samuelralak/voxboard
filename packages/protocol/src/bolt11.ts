/**
 * Minimal, typed wrapper over light-bolt11-decoder for NIP-57 zap validation. The decoder only PARSES
 * an invoice; it does not verify the invoice signature, so its output is untrusted structural data.
 * Everything fails closed: any missing/malformed field returns null and the receipt is rejected.
 *
 * The bolt11 invoice is the AUTHORITATIVE amount source for a zap (never a tag, never a server total).
 */

import { decode } from "light-bolt11-decoder";

export interface DecodedInvoice {
  /** authoritative zapped amount, in millisats */
  amountMsat: bigint;
  /** lowercase hex; the cross-idea dedupe key */
  paymentHash: string;
  /** lowercase hex; binds the invoice to a specific kind-9734 (its description). null if absent */
  descriptionHash: string | null;
  timestamp: number | null;
  /** seconds; bolt11 default is 3600 when omitted */
  expiry: number | null;
}

interface Section {
  name?: string;
  value?: unknown;
}

const HEX = /^[0-9a-f]+$/;
const DIGITS = /^[0-9]+$/;

function sectionValue(sections: Section[], name: string): string | undefined {
  const found = sections.find((s) => s?.name === name);
  return typeof found?.value === "string" ? found.value : undefined;
}

/**
 * Decode a bolt11 invoice for zap validation. Returns null on ANY structural problem — an amountless
 * invoice, a missing/garbage payment_hash, a non-numeric amount — so an attacker cannot smuggle a
 * tag-stated amount past a zero/absent invoice amount.
 */
export function decodeInvoice(pr: string): DecodedInvoice | null {
  let sections: Section[];
  try {
    const parsed = decode(pr) as { sections?: unknown };
    if (!Array.isArray(parsed.sections)) return null;
    sections = parsed.sections as Section[];
  } catch {
    return null;
  }

  const amountRaw = sectionValue(sections, "amount");
  if (!amountRaw || !DIGITS.test(amountRaw)) return null; // amountless / non-numeric => reject
  let amountMsat: bigint;
  try {
    amountMsat = BigInt(amountRaw);
  } catch {
    return null;
  }
  if (amountMsat <= BigInt(0)) return null;

  const paymentHash = sectionValue(sections, "payment_hash")?.toLowerCase();
  if (!paymentHash || !HEX.test(paymentHash)) return null; // no dedupe key => reject

  const descriptionHashRaw = sectionValue(sections, "description_hash")?.toLowerCase() ?? null;
  const descriptionHash = descriptionHashRaw && HEX.test(descriptionHashRaw) ? descriptionHashRaw : null;

  const ts = sectionValue(sections, "timestamp");
  const exp = sectionValue(sections, "expiry");
  return {
    amountMsat,
    paymentHash,
    descriptionHash,
    timestamp: ts && DIGITS.test(ts) ? Number(ts) : null,
    expiry: exp && DIGITS.test(exp) ? Number(exp) : null,
  };
}
