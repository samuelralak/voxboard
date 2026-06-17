import { describe, it, expect } from "vitest";
import { acceptedCount, configuredRelays } from "../src/relays.js";

describe("acceptedCount (publish fail-closed)", () => {
  it("does NOT count a nostr-tools 'connection failure' resolve as an accepted publish", () => {
    const results: PromiseSettledResult<string>[] = [
      { status: "fulfilled", value: "" }, // a real relay OK (empty reason)
      { status: "fulfilled", value: "connection failure: ECONNREFUSED" }, // unreachable, resolved not rejected
      { status: "rejected", reason: new Error("relay rejected the event") },
    ];
    expect(acceptedCount(results)).toBe(1);
  });

  it("returns 0 when every relay was unreachable (so publishOrThrow fails closed)", () => {
    const allDown: PromiseSettledResult<string>[] = [
      { status: "fulfilled", value: "connection failure: x" },
      { status: "fulfilled", value: "connection failure: y" },
    ];
    expect(acceptedCount(allDown)).toBe(0);
  });

  it("counts real OK reasons (including non-empty messages)", () => {
    const ok: PromiseSettledResult<string>[] = [
      { status: "fulfilled", value: "" },
      { status: "fulfilled", value: "stored" },
    ];
    expect(acceptedCount(ok)).toBe(2);
  });
});

describe("configuredRelays (SSRF-gated, fail closed)", () => {
  it("uses the safe defaults when ATTESTATION_RELAYS is unset", () => {
    expect(configuredRelays({}).length).toBeGreaterThan(0);
  });

  it("drops unsafe relays and throws when none remain", () => {
    expect(() => configuredRelays({ ATTESTATION_RELAYS: "ws://127.0.0.1,http://x" })).toThrow();
  });
});
