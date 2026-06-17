/**
 * The attestation service HTTP API — the privileged, key-touching surface.
 *
 *   GET  /            -> health + issuer pubkey + namespace
 *   POST /v1/attest   -> NIP-98 authed; the authed pubkey must OWN the board (or be an operator). Verifies
 *                        conformance, then signs + publishes the per-board label and republishes the set.
 *   POST /v1/revoke   -> NIP-98 authed AND operator-only; delists a coordinate.
 *
 * The routing/auth/dispatch core is `handleRequest`, a pure function over an injectable ServiceContext, so
 * it is unit-testable without sockets or live relays. The Node wrapper only does I/O: body read (capped),
 * URL reconstruction (for the NIP-98 `u` pin), CORS, and writing the response.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { now, parseCommunityCoordinate, sha256Hex } from "@voxboard/protocol";
import { createSigner, type Signer } from "./signer.js";
import { configuredRelays, withRelayClient, type RelayClient } from "./relays.js";
import { attestBoard } from "./attest.js";
import { issueAttestation, revokeAttestation } from "./issue.js";
import { verifyHttpAuth } from "./http-auth.js";
import { RelayUnavailableError } from "./errors.js";
import { corsOrigin, namespace, operatorPubkeys, port, publicBaseUrl } from "./config.js";

const MAX_BODY_BYTES = 16 * 1024;

export interface ServiceContext {
  signer: Signer;
  /** the env-scoped attestation namespace */
  ns: string;
  /** operator pubkeys allowed to attest any board / revoke */
  operators: Set<string>;
  /** allowed CORS origin */
  cors: string;
  /** runs a function with a relay client (real: withRelayClient; tests: a fake client) */
  run: <T>(fn: (client: RelayClient) => Promise<T>) => Promise<T>;
  /** relays, kept only for the startup log */
  relays?: string[];
  /** configured public base URL (for NIP-98 url reconstruction); kept only for the Node wrapper */
  publicBase?: string;
}

export interface HttpRequest {
  method: string;
  path: string;
  /** the reconstructed ABSOLUTE request URL the NIP-98 `u` tag must match */
  url: string;
  authorization?: string;
  body: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

export async function handleRequest(ctx: ServiceContext, req: HttpRequest): Promise<HttpResponse> {
  if (req.method === "GET" && req.path === "/") {
    return { status: 200, body: { name: "Voxboard Attestation", issuer: ctx.signer.issuerPubkey, namespace: ctx.ns } };
  }
  if (req.method === "POST" && req.path === "/v1/attest") return attest(ctx, req);
  if (req.method === "POST" && req.path === "/v1/revoke") return revoke(ctx, req);
  return { status: 404, body: { error: "not found" } };
}

async function attest(ctx: ServiceContext, req: HttpRequest): Promise<HttpResponse> {
  const auth = verifyHttpAuth(req.authorization, {
    url: req.url,
    method: "POST",
    now: now(),
    payloadHash: sha256Hex(req.body),
  });
  if (!auth.ok) return { status: 401, body: { error: auth.reason } };

  const coordinate = coordinateFromBody(req.body);
  if (!coordinate) return { status: 400, body: { error: "body must be { coordinate: '34550:<owner>:<slug>' }" } };

  try {
    return await ctx.run(async (client) => {
      const decision = await attestBoard(
        { coordinate, requester: auth.pubkey },
        { client, isOperator: (pk) => ctx.operators.has(pk) },
      );
      if (!decision.ok) return { status: 403, body: { error: decision.reason } };
      const issued = await issueAttestation(
        { coordinate: decision.coordinate, eventId: decision.eventId },
        { signer: ctx.signer, client, namespace: ctx.ns },
      );
      return {
        status: 200,
        body: { ok: true, coordinate: decision.coordinate, idempotent: issued.idempotent, attested: issued.coordinates.length },
      };
    });
  } catch (err) {
    return relayError(err);
  }
}

async function revoke(ctx: ServiceContext, req: HttpRequest): Promise<HttpResponse> {
  const auth = verifyHttpAuth(req.authorization, {
    url: req.url,
    method: "POST",
    now: now(),
    payloadHash: sha256Hex(req.body),
  });
  if (!auth.ok) return { status: 401, body: { error: auth.reason } };
  if (!ctx.operators.has(auth.pubkey)) return { status: 403, body: { error: "operator only" } };

  const parsed = parseRevokeBody(req.body);
  if (!parsed) return { status: 400, body: { error: "body must include a valid coordinate" } };

  try {
    return await ctx.run(async (client) => {
      const result = await revokeAttestation(
        parsed.eventId ? { coordinate: parsed.coordinate, eventId: parsed.eventId } : { coordinate: parsed.coordinate },
        { signer: ctx.signer, client, namespace: ctx.ns },
      );
      return { status: 200, body: { ok: true, coordinate: parsed.coordinate, attested: result.coordinates.length } };
    });
  } catch (err) {
    return relayError(err);
  }
}

function coordinateFromBody(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const coord = (parsed as { coordinate?: unknown })?.coordinate;
  return typeof coord === "string" && parseCommunityCoordinate(coord) !== null ? coord : null;
}

/** Parse the revoke body ONCE: a valid board coordinate, plus an optional 64-hex event id. */
function parseRevokeBody(body: string): { coordinate: string; eventId?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const obj = parsed as { coordinate?: unknown; eventId?: unknown };
  if (typeof obj?.coordinate !== "string" || parseCommunityCoordinate(obj.coordinate) === null) return null;
  const eventId = typeof obj.eventId === "string" && /^[0-9a-f]{64}$/.test(obj.eventId) ? obj.eventId : undefined;
  return eventId ? { coordinate: obj.coordinate, eventId } : { coordinate: obj.coordinate };
}

/**
 * Map a thrown error to a status. A RelayUnavailableError (blind read / publish reached no relay) is a
 * retryable 503 whose message is safe to surface; ANY other error is an unexpected 500 with a GENERIC body
 * so an internal message (paths, library internals) never leaks to the caller.
 */
function relayError(err: unknown): HttpResponse {
  if (err instanceof RelayUnavailableError) return { status: 503, body: { error: err.message } };
  return { status: 500, body: { error: "internal error" } };
}

// ---------------------------------------------------------------------------
// Node I/O wrapper
// ---------------------------------------------------------------------------

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new BodyTooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reconstruct the absolute request URL the client signed for the NIP-98 `u` pin. Production REQUIRES
 * ATTESTATION_PUBLIC_URL (enforced in loadContext), so prod always uses that TRUSTED origin and the `u`
 * pin can never be defeated by spoofed proxy headers. The dev-only fallback uses the Host header and
 * NEVER X-Forwarded-* (which a client controls and could set to make a token signed for another origin pass).
 */
function requestUrl(req: IncomingMessage, ctx: ServiceContext): string {
  const rawPath = req.url ?? "/";
  const base = ctx.publicBase ?? `http://${req.headers.host ?? "localhost"}`;
  // resolve, then RE-PIN to the base origin: a protocol-relative (//host) or absolute-form request target
  // can never swap the origin the NIP-98 `u` is checked against.
  const resolved = new URL(rawPath, base);
  return new URL(resolved.pathname + resolved.search, base).href;
}

function corsHeaders(cors: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": cors,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function nodeHandler(ctx: ServiceContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const cors = corsHeaders(ctx.cors);
    // Catch EVERYTHING: http.Server does not await this listener's promise, so an unhandled rejection from
    // any pre-dispatch step (verify, parse, url) would otherwise crash the whole key-holding process (DoS).
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      let body: string;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(413, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "body too large" }));
        return;
      }
      const result = await handleRequest(ctx, {
        method: req.method ?? "GET",
        path: (req.url ?? "/").split("?")[0] ?? "/",
        url: requestUrl(req, ctx),
        authorization: headerValue(req, "authorization"),
        body,
      });
      res.writeHead(result.status, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      console.error("[attestation] unhandled request error", err); // log real cause; never send it to the client
      if (!res.headersSent) {
        res.writeHead(500, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      } else {
        res.end();
      }
    }
  };
}

/** Build the service context from the environment. Throws (fail closed) if the signer or relays are unset. */
export function loadContext(env: NodeJS.ProcessEnv = process.env): ServiceContext {
  const relays = configuredRelays(env);
  const publicBase = publicBaseUrl(env);
  // Fail closed in production: without a trusted public base the NIP-98 `u` pin would be reconstructed
  // from spoofable proxy headers, weakening the cross-origin replay control. Dev may omit it (Host-only).
  if (!publicBase && env.NODE_ENV === "production") {
    throw new Error(
      "ATTESTATION_PUBLIC_URL must be set in production (the NIP-98 url pin must use a trusted origin)",
    );
  }
  return {
    signer: createSigner(env),
    ns: namespace(env),
    operators: operatorPubkeys(env),
    cors: corsOrigin(env),
    run: (fn) => withRelayClient(relays, fn),
    relays,
    ...(publicBase ? { publicBase } : {}),
  };
}

export function start(env: NodeJS.ProcessEnv = process.env): void {
  // Last-resort guards so a stray rejection/throw can never default-crash the privileged signer process.
  process.on("unhandledRejection", (reason) => console.error("[attestation] unhandledRejection", reason));
  process.on("uncaughtException", (err) => console.error("[attestation] uncaughtException", err));

  const ctx = loadContext(env);
  const server = createServer(nodeHandler(ctx));
  // tight timeouts: a NIP-98 attest/revoke is tiny + fast, so bound slowloris explicitly (base-image independent)
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  const listenPort = port(env);
  server.listen(listenPort, () => {
    // never log the private key; the issuer pubkey is public
    console.log(
      `[attestation] listening on :${listenPort} issuer=${ctx.signer.issuerPubkey.slice(0, 12)} ` +
        `relays=${ctx.relays?.length ?? 0} operators=${ctx.operators.size} ns=${ctx.ns}`,
    );
  });
}

// auto-start only when run directly (node src/server.ts), never when imported by a test
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start();
