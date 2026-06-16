/**
 * Adversarial NIP-57 zap validation. The threat: forged / inflated / mis-attributed / double-counted
 * kind-9735 receipts faking an idea's sats total. We mint REAL signed events (receipt + embedded 9734)
 * and mock the bolt11 decoder so each fixture controls the invoice's amount / payment_hash /
 * description_hash. (Real bolt11 decoding is covered separately in bolt11.test.ts.)
 *
 * The mocked bolt11 is a JSON blob `{ amountMsat?, paymentHash?, descriptionHash? }`.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("light-bolt11-decoder", () => ({
  decode: (pr: string) => {
    const o = JSON.parse(pr) as { amountMsat?: string; paymentHash?: string; descriptionHash?: string };
    const sections: { name: string; value: string }[] = [];
    if (o.amountMsat !== undefined) sections.push({ name: "amount", value: o.amountMsat });
    if (o.paymentHash !== undefined) sections.push({ name: "payment_hash", value: o.paymentHash });
    if (o.descriptionHash !== undefined) sections.push({ name: "description_hash", value: o.descriptionHash });
    return { sections };
  },
}));

import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  parseZapReceipt,
  validateZapReceipt,
  zapTotalsByTarget,
  type NostrEvent,
  type ZapExpectation,
} from "../src/index";

const serverSk = generateSecretKey(); // the recipient's LNURL server signing key (the trust anchor)
const serverPk = getPublicKey(serverSk);
const senderSk = generateSecretKey();
const attackerSk = generateSecretKey();
const attackerPk = getPublicKey(attackerSk);
const recipientPk = getPublicKey(generateSecretKey()); // the idea author being credited
const IDEA = "1d".repeat(32);
const OTHER_IDEA = "2d".repeat(32);
const LNURL = "lnurl1example";

function sha256hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)));
}

interface ZapOpts {
  amountMsat?: bigint;
  recipient?: string;
  targetEventId?: string;
  reqTags?: string[][];
  reqSk?: Uint8Array;
  recSk?: Uint8Array;
  recTags?: string[][];
  kind?: number;
  descriptionRaw?: string; // override the description tag (for binding tests)
  descriptionHash?: string; // override the invoice's description_hash
  paymentHash?: string;
  omitAmount?: boolean;
  badBolt11?: string;
  tamperReceiptSig?: boolean;
  tamperRequestSig?: boolean;
  /** extra tags appended to the receipt before signing (e.g. a spoofed duplicate e/p) */
  extraRecTags?: string[][];
}

/** Build a fully-valid receipt, then apply overrides to forge one specific thing. */
function buildReceipt(opts: ZapOpts = {}): NostrEvent {
  const amountMsat = opts.amountMsat ?? 21000n; // 21 sats
  const recipient = opts.recipient ?? recipientPk;
  const targetEventId = opts.targetEventId ?? IDEA;
  const reqTags =
    opts.reqTags ??
    [
      ["p", recipient],
      ["e", targetEventId],
      ["relays", "wss://relay.example"],
      ["amount", String(amountMsat)],
      ["lnurl", LNURL],
    ];
  const req = finalizeEvent({ kind: 9734, created_at: 1000, content: "", tags: reqTags }, opts.reqSk ?? senderSk);
  if (opts.tamperRequestSig) req.sig = "00".repeat(64);

  const descriptionRaw = opts.descriptionRaw ?? JSON.stringify(req);
  const descriptionHash = opts.descriptionHash ?? sha256hex(descriptionRaw);
  const paymentHash = opts.paymentHash ?? "ab".repeat(32);
  const bolt11 =
    opts.badBolt11 ??
    JSON.stringify({
      ...(opts.omitAmount ? {} : { amountMsat: String(amountMsat) }),
      paymentHash,
      descriptionHash,
    });

  const recTags =
    opts.recTags ??
    [
      ["p", recipient],
      ["e", targetEventId],
      ["bolt11", bolt11],
      ["description", descriptionRaw],
      ["P", req.pubkey],
      ...(opts.extraRecTags ?? []),
    ];
  const signed = finalizeEvent(
    { kind: opts.kind ?? 9735, created_at: 1001, content: "", tags: recTags },
    opts.recSk ?? serverSk,
  );
  // Round-trip through JSON to drop nostr-tools' non-enumerable verified-symbol cache, so verifyEvent
  // actually re-checks the signature — exactly like an event delivered as plain JSON by a relay.
  const receipt = JSON.parse(JSON.stringify(signed)) as NostrEvent & { sig: string };
  if (opts.tamperReceiptSig) receipt.sig = "00".repeat(64);
  return receipt;
}

const expectation: ZapExpectation = {
  targetEventId: IDEA,
  recipientPubkey: recipientPk,
  lnurlNostrPubkey: serverPk,
  lnurl: LNURL,
};

function validate(receipt: NostrEvent, exp: ZapExpectation = expectation) {
  const parsed = parseZapReceipt(receipt);
  expect(parsed).not.toBeNull();
  return validateZapReceipt(parsed!, exp);
}

describe("zap: golden path accepts", () => {
  it("a correctly-built receipt validates and reports the bolt11 amount", () => {
    const r = validate(buildReceipt());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amountMsat).toBe(21000n);
      expect(r.recipient).toBe(recipientPk);
      expect(r.targetEventId).toBe(IDEA);
      expect(r.senderPubkey).toBe(getPublicKey(senderSk));
    }
  });

  it("an anonymous zap (no P tag) is still valid and counted", () => {
    const recipient = recipientPk;
    const req = finalizeEvent(
      { kind: 9734, created_at: 1000, content: "", tags: [["p", recipient], ["e", IDEA], ["relays", "wss://r"]] },
      senderSk,
    );
    const descriptionRaw = JSON.stringify(req);
    const bolt11 = JSON.stringify({ amountMsat: "5000", paymentHash: "cd".repeat(32), descriptionHash: sha256hex(descriptionRaw) });
    const receipt = finalizeEvent(
      { kind: 9735, created_at: 1001, content: "", tags: [["p", recipient], ["e", IDEA], ["bolt11", bolt11], ["description", descriptionRaw]] },
      serverSk,
    ) as NostrEvent;
    const r = validate(receipt);
    expect(r.ok).toBe(true);
  });
});

describe("zap: forgery rejections (one per attack class)", () => {
  it("A1 self-signed forged receipt (not the LNURL key) -> anchor-mismatch", () => {
    const r = validate(buildReceipt({ recSk: attackerSk }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("anchor-mismatch");
  });

  it("no anchor supplied -> no-anchor (fail closed)", () => {
    const r = validate(buildReceipt(), { ...expectation, lnurlNostrPubkey: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-anchor");
  });

  it("A2 tag-stated amount larger than the invoice -> amount-tag-mismatch", () => {
    const r = validate(
      buildReceipt({
        reqTags: [["p", recipientPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "1000000"], ["lnurl", LNURL]],
        amountMsat: 21000n, // invoice says 21000, request claims 1000000
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("amount-tag-mismatch");
  });

  it("A2 amountless invoice -> bad-invoice", () => {
    const r = validate(buildReceipt({ omitAmount: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad-invoice");
  });

  it("C1 real invoice re-wrapped onto another idea (description_hash binds the original) -> description-binding", () => {
    // The invoice's description_hash is for the ORIGINAL 9734, but the attacker swaps the receipt's
    // description to a new 9734 pointing at the victim idea. sha256(newDescription) != hash.
    const realReq = finalizeEvent(
      { kind: 9734, created_at: 1000, content: "", tags: [["p", recipientPk], ["e", OTHER_IDEA], ["relays", "wss://r"], ["amount", "21000"]] },
      senderSk,
    );
    const realHash = sha256hex(JSON.stringify(realReq));
    const fakeReq = finalizeEvent(
      { kind: 9734, created_at: 1000, content: "", tags: [["p", recipientPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "21000"]] },
      senderSk,
    );
    const r = validate(buildReceipt({ descriptionRaw: JSON.stringify(fakeReq), descriptionHash: realHash }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("description-binding");
  });

  it("D1 tampered receipt signature -> receipt-sig", () => {
    const r = validate(buildReceipt({ tamperReceiptSig: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("receipt-sig");
  });

  it("D1 tampered embedded 9734 signature -> request-sig", () => {
    const r = validate(buildReceipt({ tamperRequestSig: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("request-sig");
  });

  it("D4 embedded 9734 with two p tags -> request-coherence", () => {
    const r = validate(
      buildReceipt({
        reqTags: [["p", recipientPk], ["p", attackerPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "21000"]],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("request-coherence");
  });

  it("D4 embedded 9734 missing relays tag -> request-coherence", () => {
    const r = validate(buildReceipt({ reqTags: [["p", recipientPk], ["e", IDEA], ["amount", "21000"]] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("request-coherence");
  });

  it("D5 9734 lnurl tag pointing elsewhere -> lnurl-mismatch", () => {
    const r = validate(
      buildReceipt({
        reqTags: [["p", recipientPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "21000"], ["lnurl", "lnurl1evil"]],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("lnurl-mismatch");
  });

  it("C5 zap credited to the wrong idea -> target-mismatch", () => {
    const r = validate(buildReceipt({ targetEventId: OTHER_IDEA })); // expectation targets IDEA
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("target-mismatch");
  });

  it("outer receipt e disagreeing with the embedded 9734 e -> target-mismatch", () => {
    // embedded 9734 names OTHER_IDEA, outer receipt names IDEA, expectation targets IDEA.
    const req = finalizeEvent(
      { kind: 9734, created_at: 1000, content: "", tags: [["p", recipientPk], ["e", OTHER_IDEA], ["relays", "wss://r"], ["amount", "21000"]] },
      senderSk,
    );
    const descriptionRaw = JSON.stringify(req);
    const bolt11 = JSON.stringify({ amountMsat: "21000", paymentHash: "ef".repeat(32), descriptionHash: sha256hex(descriptionRaw) });
    const receipt = finalizeEvent(
      { kind: 9735, created_at: 1001, content: "", tags: [["p", recipientPk], ["e", IDEA], ["bolt11", bolt11], ["description", descriptionRaw]] },
      serverSk,
    ) as NostrEvent;
    const v = validate(receipt);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("target-mismatch");
  });

  it("recipient mismatch (9734 p != credited pubkey) -> recipient-mismatch", () => {
    const r = validate(buildReceipt(), { ...expectation, recipientPubkey: attackerPk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("recipient-mismatch");
  });

  it("A6 amount outside the recipient's sendable bounds -> out-of-bounds", () => {
    const r = validate(buildReceipt({ amountMsat: 21000n }), {
      ...expectation,
      minSendableMsat: 100000n,
      maxSendableMsat: 1000000n,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("out-of-bounds");
  });

  it("non-9735 kind -> rejected at parse", () => {
    expect(parseZapReceipt(buildReceipt({ kind: 9735 }) /* valid */)).not.toBeNull();
    expect(parseZapReceipt(buildReceipt({ kind: 1 }))).toBeNull();
  });
});

describe("zap: tag-confusion + encoding invariants (regression locks)", () => {
  it("a %-encoded description tag is decoded once before hashing (binding over the decoded JSON)", () => {
    const req = finalizeEvent(
      { kind: 9734, created_at: 1000, content: "", tags: [["p", recipientPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "21000"]] },
      senderSk,
    );
    const decoded = JSON.stringify(req);
    const encoded = encodeURIComponent(decoded); // starts with %7B...
    const mk = (descriptionHash: string, ph: string) => {
      const bolt11 = JSON.stringify({ amountMsat: "21000", paymentHash: ph, descriptionHash });
      return JSON.parse(
        JSON.stringify(
          finalizeEvent(
            { kind: 9735, created_at: 1001, content: "", tags: [["p", recipientPk], ["e", IDEA], ["bolt11", bolt11], ["description", encoded]] },
            serverSk,
          ),
        ),
      ) as NostrEvent;
    };
    // hash over the DECODED bytes -> accepted
    expect(validate(mk(sha256hex(decoded), "31".repeat(32))).ok).toBe(true);
    // hash over the still-encoded bytes -> rejected
    const bad = validate(mk(sha256hex(encoded), "32".repeat(32)));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("description-binding");
  });

  it("a spoofed duplicate outer e/p tag is ignored (first tag wins, and it matches)", () => {
    const r = validate(buildReceipt({ extraRecTags: [["e", OTHER_IDEA], ["p", attackerPk]] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.targetEventId).toBe(IDEA);
      expect(r.recipient).toBe(recipientPk);
    }
  });

  it("the advisory P tag is ignored for sender/self-zap detection (sender = signed 9734 author)", () => {
    const recipSk = generateSecretKey();
    const recipPk = getPublicKey(recipSk);
    // 9734 signed by the ATTACKER but claiming p = recipient; outer P spoofed to the recipient.
    const req = finalizeEvent(
      { kind: 9734, created_at: 1000, content: "", tags: [["p", recipPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "21000"]] },
      attackerSk,
    );
    const descriptionRaw = JSON.stringify(req);
    const bolt11 = JSON.stringify({ amountMsat: "21000", paymentHash: "41".repeat(32), descriptionHash: sha256hex(descriptionRaw) });
    const receipt = JSON.parse(
      JSON.stringify(
        finalizeEvent(
          { kind: 9735, created_at: 1001, content: "", tags: [["p", recipPk], ["e", IDEA], ["bolt11", bolt11], ["description", descriptionRaw], ["P", recipPk]] },
          serverSk,
        ),
      ),
    ) as NostrEvent;
    const exp = { targetEventId: IDEA, recipientPubkey: recipPk, lnurlNostrPubkey: serverPk };
    const v = validateZapReceipt(parseZapReceipt(receipt)!, exp);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.senderPubkey).toBe(attackerPk); // the signed author, not the spoofed P tag
    // excludeSelfZaps must NOT drop it: the true sender (attacker) != recipient
    expect(zapTotalsByTarget([receipt], () => exp, { excludeSelfZaps: true }).get(IDEA)?.sats).toBe(21);
  });

  it("the 9734 amount tag is compared strictly (leading zero / whitespace / sign -> mismatch)", () => {
    for (const amt of ["021000", " 21000", "+21000"]) {
      const r = validate(
        buildReceipt({
          amountMsat: 21000n,
          reqTags: [["p", recipientPk], ["e", IDEA], ["relays", "wss://r"], ["amount", amt], ["lnurl", LNURL]],
        }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("amount-tag-mismatch");
    }
  });
});

describe("zap: totals + dedupe", () => {
  const resolve = (): ZapExpectation => expectation;

  it("sums validated zaps and floors msat -> sat", () => {
    const a = buildReceipt({ amountMsat: 21000n, paymentHash: "a1".repeat(32) });
    const b = buildReceipt({ amountMsat: 1999n, paymentHash: "b2".repeat(32) }); // 1 sat (floor)
    const totals = zapTotalsByTarget([a, b], resolve);
    const t = totals.get(IDEA)!;
    expect(t.msat).toBe(22999n);
    expect(t.sats).toBe(22); // floor(22999/1000)
    expect(t.zapCount).toBe(2);
  });

  it("B1 the same receipt seen on many relays counts once", () => {
    const a = buildReceipt({ amountMsat: 21000n, paymentHash: "c3".repeat(32) });
    const totals = zapTotalsByTarget([a, a, a], resolve);
    expect(totals.get(IDEA)!.sats).toBe(21);
    expect(totals.get(IDEA)!.zapCount).toBe(1);
  });

  it("B2 two different receipts sharing one payment_hash count once", () => {
    const ph = "d4".repeat(32);
    const a = buildReceipt({ amountMsat: 21000n, paymentHash: ph });
    // a second, independently-signed receipt for the same payment
    const b = buildReceipt({ amountMsat: 21000n, paymentHash: ph });
    expect(a.id).not.toBe(b.id);
    const totals = zapTotalsByTarget([a, b], resolve);
    expect(totals.get(IDEA)!.sats).toBe(21);
    expect(totals.get(IDEA)!.zapCount).toBe(1);
  });

  it("forged receipts contribute zero to the total", () => {
    const good = buildReceipt({ amountMsat: 21000n, paymentHash: "e5".repeat(32) });
    const forged = buildReceipt({ recSk: attackerSk, amountMsat: 9_000_000n, paymentHash: "f6".repeat(32) });
    const totals = zapTotalsByTarget([good, forged], resolve);
    expect(totals.get(IDEA)!.sats).toBe(21); // the 9000-sat forgery is dropped
    expect(totals.get(IDEA)!.zapCount).toBe(1);
  });

  it("B3 same payment_hash, same target via two receipt ids: counted once, deterministic", () => {
    const ph = "1a".repeat(32);
    const a = buildReceipt({ amountMsat: 21000n, paymentHash: ph });
    const b = buildReceipt({ amountMsat: 21000n, paymentHash: ph });
    // order independence: same total + count regardless of input order
    const t1 = zapTotalsByTarget([a, b], resolve).get(IDEA)!;
    const t2 = zapTotalsByTarget([b, a], resolve).get(IDEA)!;
    expect(t1.sats).toBe(21);
    expect(t1.zapCount).toBe(1);
    expect(t2.sats).toBe(t1.sats);
    expect(t2.zapCount).toBe(t1.zapCount);
  });

  it("excludeSelfZaps drops a zap where sender == recipient", () => {
    // recipient zaps themselves: the 9734 is signed by the recipient and p=recipient
    const recipSk = generateSecretKey();
    const recipPk = getPublicKey(recipSk);
    const exp: ZapExpectation = { targetEventId: IDEA, recipientPubkey: recipPk, lnurlNostrPubkey: serverPk, lnurl: LNURL };
    const selfZap = buildReceipt({ recipient: recipPk, reqSk: recipSk, paymentHash: "07".repeat(32),
      reqTags: [["p", recipPk], ["e", IDEA], ["relays", "wss://r"], ["amount", "21000"], ["lnurl", LNURL]] });
    const withSelf = zapTotalsByTarget([selfZap], () => exp);
    expect(withSelf.get(IDEA)!.sats).toBe(21);
    const without = zapTotalsByTarget([selfZap], () => exp, { excludeSelfZaps: true });
    expect(without.get(IDEA)).toBeUndefined();
  });
});
