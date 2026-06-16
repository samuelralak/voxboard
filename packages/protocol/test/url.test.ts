import { describe, it, expect } from "vitest";
import { isUnsafeHost, isSafeRelayUrl } from "../src/url";

/**
 * The SSRF host filter is security-critical (it gates outbound requests in BOTH the web zap path and the
 * indexer relay connections), so it gets its own adversarial test. The canonicalize-through-URL-parser-
 * first step is what catches the encoded IPv4 forms; assert each bypass vector is rejected.
 */

describe("isUnsafeHost", () => {
  it("rejects loopback + internal suffixes", () => {
    for (const h of ["localhost", "foo.local", "svc.internal", "abcd.onion"]) {
      expect(isUnsafeHost(h)).toBe(true);
    }
  });

  it("rejects all IPv4 literal encodings (dotted, decimal, hex, octal) via URL canonicalization", () => {
    for (const h of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "2130706433", "0x7f000001", "0177.0.0.1"]) {
      expect(isUnsafeHost(h)).toBe(true);
    }
  });

  it("rejects IPv6 literals including loopback and IPv4-mapped", () => {
    for (const h of ["[::1]", "[::ffff:127.0.0.1]", "[fe80::1]"]) {
      expect(isUnsafeHost(h)).toBe(true);
    }
  });

  it("allows ordinary DNS hostnames", () => {
    for (const h of ["relay.damus.io", "nos.lol", "relay.primal.net", "example.com"]) {
      expect(isUnsafeHost(h)).toBe(false);
    }
  });
});

describe("isSafeRelayUrl", () => {
  it("accepts ws/wss URLs to public DNS hosts", () => {
    expect(isSafeRelayUrl("wss://relay.damus.io")).toBe(true);
    expect(isSafeRelayUrl("ws://nos.lol/")).toBe(true);
  });

  it("rejects non-ws schemes", () => {
    for (const u of ["https://relay.damus.io", "http://nos.lol", "file:///etc/passwd", "ftp://x"]) {
      expect(isSafeRelayUrl(u)).toBe(false);
    }
  });

  it("rejects unparseable input and unsafe hosts", () => {
    for (const u of ["", "not a url", "wss://localhost", "wss://127.0.0.1", "ws://[::1]", "wss://2130706433"]) {
      expect(isSafeRelayUrl(u)).toBe(false);
    }
  });
});
