import { describe, it, expect } from "vitest";
import type { EventTemplate, NostrEvent } from "../src/event.js";
import { KIND } from "../src/kinds.js";
import { buildHttpAuth, parseHttpAuth, sha256Hex } from "../src/http-auth.js";

const SIG = "0".repeat(128);
const PUB = "ab".repeat(32);
let idCounter = 0;
function asEvent(template: EventTemplate, pubkey = PUB): NostrEvent {
  return { ...template, pubkey, id: (idCounter++).toString(16).padStart(64, "0"), sig: SIG };
}

describe("NIP-98 http auth", () => {
  it("builds a 27235 event pinning url, uppercased method, and payload", () => {
    const tmpl = buildHttpAuth({ url: "https://x.test/v1/attest", method: "post", payload: "deadbeef" });
    expect(tmpl.kind).toBe(KIND.HttpAuth);
    expect(tmpl.tags).toContainEqual(["u", "https://x.test/v1/attest"]);
    expect(tmpl.tags).toContainEqual(["method", "POST"]);
    expect(tmpl.tags).toContainEqual(["payload", "deadbeef"]);
  });

  it("omits the payload tag when no payload is given", () => {
    const tmpl = buildHttpAuth({ url: "https://x.test/v1/attest", method: "GET" });
    expect(tmpl.tags.some((t) => t[0] === "payload")).toBe(false);
  });

  it("round-trips through parseHttpAuth", () => {
    const event = asEvent(buildHttpAuth({ url: "https://x.test/v1/attest", method: "POST", payload: "ab12" }));
    const parsed = parseHttpAuth(event);
    expect(parsed?.url).toBe("https://x.test/v1/attest");
    expect(parsed?.method).toBe("POST");
    expect(parsed?.payload).toBe("ab12");
    expect(parsed?.pubkey).toBe(PUB);
  });

  it("rejects a wrong kind or a missing u/method tag", () => {
    expect(parseHttpAuth(asEvent({ ...buildHttpAuth({ url: "u", method: "POST" }), kind: 1 }))).toBeNull();
    const noUrl: NostrEvent = { ...asEvent(buildHttpAuth({ url: "u", method: "POST" })), tags: [["method", "POST"]] };
    expect(parseHttpAuth(noUrl)).toBeNull();
    const noMethod: NostrEvent = { ...asEvent(buildHttpAuth({ url: "u", method: "POST" })), tags: [["u", "u"]] };
    expect(parseHttpAuth(noMethod)).toBeNull();
  });

  it("sha256Hex is deterministic and 64-hex", () => {
    const h = sha256Hex(JSON.stringify({ coordinate: "34550:ab:slug" }));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("")).toBe(sha256Hex("")); // stable
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});
