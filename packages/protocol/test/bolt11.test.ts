/**
 * decodeInvoice against the REAL light-bolt11-decoder (no mock here). Verifies the section-name mapping
 * and the fail-closed behavior. Uses a BOLT #11 spec test vector with a known amount + payment_hash.
 */

import { describe, expect, it } from "vitest";
import { decodeInvoice } from "../src/bolt11";

// BOLT #11 spec vector: amount 2500u (= 250_000_000 msat), payment_hash 0001..0102.
const INV_2500U =
  "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";

describe("decodeInvoice (real bolt11)", () => {
  it("extracts the amount (msat) and payment_hash from a real invoice", () => {
    const d = decodeInvoice(INV_2500U);
    expect(d).not.toBeNull();
    expect(d!.amountMsat).toBe(250_000_000n);
    expect(d!.paymentHash).toBe("0001020304050607080900010203040506070809000102030405060708090102");
  });

  it("fails closed on garbage / empty / non-bolt11 input", () => {
    expect(decodeInvoice("not a bolt11")).toBeNull();
    expect(decodeInvoice("")).toBeNull();
    expect(decodeInvoice("lnbc")).toBeNull();
  });
});
