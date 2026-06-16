/**
 * Voxboard Aggregator — Worker entry. Routes HTTP requests to the per-board Durable Object
 * (deterministically by the board coordinate) and serves the read API. See docs/INDEXER.md.
 *
 *   POST /v1/track       { coordinate, relays }            -> begin tracking a board
 *   GET  /v1/stats       ?coordinate=...                   -> raw per-board stats
 *   GET  /v1/ideas       ?coordinate=&sort=&status=&tag=   -> aggregated, sorted ideas
 *   GET  /v1/idea        ?coordinate=&id=                  -> a single idea's stats
 *   GET  /v1/roadmap     ?coordinate=...                   -> ideas grouped by status
 *   GET  /v1/moderation  ?coordinate=...                   -> owner / mods / banned / hidden / mode
 */

import { z } from "zod";
import { isSafeRelayUrl, parseCommunityCoordinate } from "@voxboard/protocol";
import { BoardAggregator, type Env, type IdeaSort } from "./board-aggregator";

export { BoardAggregator };

const SORTS = new Set<IdeaSort>(["top", "trending", "new"]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const trackSchema = z.object({
  coordinate: z.string().refine((c) => parseCommunityCoordinate(c) !== null, "not a 34550 coordinate"),
  // SSRF gate: each relay must be a parseable ws/wss URL whose host is not loopback/private/an IP literal
  // (shared isSafeRelayUrl, also re-checked in connectRelay). Capped at 5 — outbound WebSockets do not
  // hibernate and count against the DO's ~6 simultaneous-connection ceiling.
  relays: z.array(z.string().refine(isSafeRelayUrl, "unsafe relay url")).min(1).max(5),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/" && request.method === "GET") {
        return json({ name: "Voxboard Aggregator", status: "ok" });
      }

      if (url.pathname === "/v1/track" && request.method === "POST") {
        const parsed = trackSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return json({ error: "invalid body", issues: parsed.error.issues }, 400);
        }
        const stub = env.BOARD_AGGREGATOR.getByName(parsed.data.coordinate);
        await stub.track(parsed.data);
        return json({ ok: true });
      }

      if (request.method === "GET") {
        const stub = boardStub(env, url);

        if (url.pathname === "/v1/stats") {
          if (!stub) return json({ error: "missing or invalid coordinate" }, 400);
          return json(await stub.stats());
        }

        if (url.pathname === "/v1/ideas") {
          if (!stub) return json({ error: "missing or invalid coordinate" }, 400);
          const sortParam = url.searchParams.get("sort");
          const sort = sortParam && SORTS.has(sortParam as IdeaSort) ? (sortParam as IdeaSort) : "top";
          const opts: { sort: IdeaSort; status?: string; tag?: string } = { sort };
          const status = url.searchParams.get("status");
          const tag = url.searchParams.get("tag");
          if (status) opts.status = status;
          if (tag) opts.tag = tag;
          return json(await stub.getIdeas(opts));
        }

        if (url.pathname === "/v1/idea") {
          const id = url.searchParams.get("id");
          if (!stub || !id) return json({ error: "missing coordinate or id" }, 400);
          return json({ idea: await stub.getIdeaStats(id) });
        }

        if (url.pathname === "/v1/roadmap") {
          if (!stub) return json({ error: "missing or invalid coordinate" }, 400);
          return json(await stub.getRoadmap());
        }

        if (url.pathname === "/v1/moderation") {
          if (!stub) return json({ error: "missing or invalid coordinate" }, 400);
          return json(await stub.getModeration());
        }
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "request failed", path: url.pathname, error: String(error) }));
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

/** Resolve the per-board DO stub from a `?coordinate=` query param, or null if missing/invalid. */
function boardStub(env: Env, url: URL) {
  const coordinate = url.searchParams.get("coordinate");
  if (!coordinate || parseCommunityCoordinate(coordinate) === null) return null;
  return env.BOARD_AGGREGATOR.getByName(coordinate);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
