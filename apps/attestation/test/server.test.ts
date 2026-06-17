import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";
import {
  attestationNamespace,
  buildAttestationLabel,
  buildAttestationSet,
  buildBoard,
  buildHttpAuth,
  communityCoordinate,
  now,
  sha256Hex,
  type NostrEvent,
} from "@voxboard/protocol";
import { createSigner } from "../src/signer.js";
import { handleRequest, loadContext, type ServiceContext } from "../src/server.js";
import { fakeRelays } from "./fake-relays.js";

const signer = createSigner({ ATTESTATION_PRIVATE_KEY: bytesToHex(generateSecretKey()) });
const NS = attestationNamespace("test");

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const operatorSk = generateSecretKey();
const operator = getPublicKey(operatorSk);

const ATTEST_URL = "https://attestation.test/v1/attest";
const REVOKE_URL = "https://attestation.test/v1/revoke";

const boardEvent = (slug = "demo", name = "Demo"): NostrEvent =>
  finalizeEvent(buildBoard({ slug, name }), ownerSk) as NostrEvent;
const coordOf = (slug: string) => communityCoordinate({ pubkey: owner, slug });

function ctxWith(seed: NostrEvent[], opts: { responded?: number } = {}) {
  const fr = fakeRelays(seed, opts);
  const ctx: ServiceContext = {
    signer,
    ns: NS,
    operators: new Set([operator]),
    cors: "*",
    run: (fn) => fn(fr.client),
  };
  return { ctx, fr };
}

/** Sign a NIP-98 Authorization header for a key + url + body (payload-bound). */
function authHeader(sk: Uint8Array, url: string, body: string): string {
  const event = finalizeEvent(
    buildHttpAuth({ url, method: "POST", payload: sha256Hex(body), createdAt: now() }),
    sk,
  ) as NostrEvent;
  return "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
}

describe("POST /v1/attest", () => {
  it("attests a board for its authenticated owner (label + set published)", async () => {
    const { ctx, fr } = ctxWith([boardEvent()]);
    const body = JSON.stringify({ coordinate: coordOf("demo") });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/attest",
      url: ATTEST_URL,
      authorization: authHeader(ownerSk, ATTEST_URL, body),
      body,
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(fr.published.length).toBeGreaterThanOrEqual(2); // label + set
  });

  it("401 when NIP-98 auth is missing", async () => {
    const { ctx } = ctxWith([boardEvent()]);
    const body = JSON.stringify({ coordinate: coordOf("demo") });
    const res = await handleRequest(ctx, { method: "POST", path: "/v1/attest", url: ATTEST_URL, body });
    expect(res.status).toBe(401);
  });

  it("403 when the authed pubkey is not the board owner", async () => {
    const { ctx } = ctxWith([boardEvent()]);
    const body = JSON.stringify({ coordinate: coordOf("demo") });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/attest",
      url: ATTEST_URL,
      authorization: authHeader(generateSecretKey(), ATTEST_URL, body),
      body,
    });
    expect(res.status).toBe(403);
  });

  it("401 when the auth was signed for a DIFFERENT body (payload pin blocks coordinate-swap replay)", async () => {
    const { ctx } = ctxWith([boardEvent()]);
    const body = JSON.stringify({ coordinate: coordOf("demo") });
    const otherBody = JSON.stringify({ coordinate: coordOf("evil") });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/attest",
      url: ATTEST_URL,
      authorization: authHeader(ownerSk, ATTEST_URL, otherBody), // header bound to otherBody
      body, // but a different body is sent
    });
    expect(res.status).toBe(401);
  });

  it("400 on a malformed coordinate body", async () => {
    const { ctx } = ctxWith([boardEvent()]);
    const body = JSON.stringify({ coordinate: "not-a-coordinate" });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/attest",
      url: ATTEST_URL,
      authorization: authHeader(ownerSk, ATTEST_URL, body),
      body,
    });
    expect(res.status).toBe(400);
  });

  it("503 (not 500) when relays are unreachable mid-issue (typed RelayUnavailableError)", async () => {
    const { ctx } = ctxWith([boardEvent()], { responded: 0 }); // board found, but the set/label read is blind
    const body = JSON.stringify({ coordinate: coordOf("demo") });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/attest",
      url: ATTEST_URL,
      authorization: authHeader(ownerSk, ATTEST_URL, body),
      body,
    });
    expect(res.status).toBe(503);
  });
});

describe("POST /v1/revoke", () => {
  it("lets an operator revoke an attested board (dropped from the set)", async () => {
    const board = boardEvent();
    const coordinate = coordOf("demo");
    const seed = [
      board,
      signer.sign(buildAttestationLabel({ coordinate, eventId: board.id, namespace: NS })),
      signer.sign(buildAttestationSet({ coordinates: [coordinate], namespace: NS })),
    ];
    const { ctx } = ctxWith(seed);
    const body = JSON.stringify({ coordinate });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/revoke",
      url: REVOKE_URL,
      authorization: authHeader(operatorSk, REVOKE_URL, body),
      body,
    });
    expect(res.status).toBe(200);
    expect((res.body as { attested: number }).attested).toBe(0);
  });

  it("403 when a non-operator tries to revoke", async () => {
    const { ctx } = ctxWith([boardEvent()]);
    const body = JSON.stringify({ coordinate: coordOf("demo") });
    const res = await handleRequest(ctx, {
      method: "POST",
      path: "/v1/revoke",
      url: REVOKE_URL,
      authorization: authHeader(ownerSk, REVOKE_URL, body), // owner, not operator
      body,
    });
    expect(res.status).toBe(403);
  });
});

describe("misc routes", () => {
  it("GET / returns health with the issuer pubkey", async () => {
    const { ctx } = ctxWith([]);
    const res = await handleRequest(ctx, { method: "GET", path: "/", url: "https://attestation.test/", body: "" });
    expect(res.status).toBe(200);
    expect((res.body as { issuer: string }).issuer).toBe(signer.issuerPubkey);
  });

  it("404 for unknown routes", async () => {
    const { ctx } = ctxWith([]);
    const res = await handleRequest(ctx, { method: "POST", path: "/nope", url: "https://attestation.test/nope", body: "" });
    expect(res.status).toBe(404);
  });
});

describe("loadContext fail-closed config", () => {
  const sk = generateSecretKey();
  const key = bytesToHex(sk);
  const pub = getPublicKey(sk);
  const prodOk = { NODE_ENV: "production", ATTESTATION_PRIVATE_KEY: key, ATTESTATION_PUBKEY: pub, ATTESTATION_PUBLIC_URL: "https://a.test" };

  it("throws in production when ATTESTATION_PUBLIC_URL is unset (no proxy-header url trust)", () => {
    expect(() => loadContext({ ...prodOk, ATTESTATION_PUBLIC_URL: undefined })).toThrow(/ATTESTATION_PUBLIC_URL/);
  });

  it("throws in production when ATTESTATION_PUBKEY is unset (issuer anchor must be declared)", () => {
    expect(() => loadContext({ ...prodOk, ATTESTATION_PUBKEY: undefined })).toThrow(/ATTESTATION_PUBKEY/);
  });

  it("loads in production when both ATTESTATION_PUBLIC_URL and ATTESTATION_PUBKEY are set", () => {
    const ctx = loadContext(prodOk);
    expect(ctx.publicBase).toBe("https://a.test");
  });

  it("loads in dev without a public URL or declared pubkey (Host-only fallback)", () => {
    const ctx = loadContext({ NODE_ENV: "development", ATTESTATION_PRIVATE_KEY: key });
    expect(ctx.publicBase).toBeUndefined();
  });
});
