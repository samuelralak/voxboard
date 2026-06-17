# Caching: server-side read caching

When Voxboard adds a server-side read cache, it leans on SQLite rather than the NDK Redis/SQLite cache adapters. This doc records why, and the shape that cache should take.

## The question

A common suggestion is to use `@nostr-dev-kit/ndk-cache-redis` or `@nostr-dev-kit/ndk-cache-sqlite` to cache reads.

Short answer: those are NDK cache adapters, and an NDK cache adapter only helps reads that flow through an `NDK` instance. The web app's slow path (server-side rendering) does not use NDK, so neither adapter drops in there. The browser, which does use NDK, is already cached. To speed up cold SSR and cut relay load, the right tool is a small server-side cache the app owns, and SQLite is a better fit than Redis for this case.

## Caches that exist today

| Layer | Mechanism | Scope | Where |
|---|---|---|---|
| Browser | NDK + `NDKCacheAdapterDexie` (IndexedDB) | persists across sessions | `apps/web/lib/nostr/ndk.ts` |
| SSR (server) | nostr-tools `SimplePool.querySync` + React `cache()` | per-request dedup only | `apps/web/lib/nostr/server.ts` |
| Server persistent cache | none | n/a | n/a |
| Indexer (aggregator) | Cloudflare DO + SQLite | built, deferred, not wired | `apps/indexer/`, [INDEXER.md](./INDEXER.md) |

The client is already cached (Dexie), so repeat visitors are fast. The gap is the server: every board and discover page is `force-dynamic` and does a fresh relay round-trip via `SimplePool`, with only React's `cache()` deduping the `generateMetadata` + page-body calls within a single request (`fetchBoardSnapshotByKey` in `server.ts`). Discover is the worst offender: `fetchDiscoverBoards` scans all public boards on every load.

## Why the NDK adapters do not fit the web SSR

1. **SSR is not NDK.** Server reads go through `SimplePool` (`apps/web/lib/nostr/server.ts`), which has no cache-adapter concept. NDK's adapters plug into an `NDK` instance, and there is none on the server. Using one would mean running NDK inside the Next server and routing SSR through it, but NDK v3 is client-fenced (`import "client-only"` in `ndk.ts`) with an outbox / websocket model built for a long-lived process, not a scale-to-zero request handler.
2. **The names suggested are NDK v2.** Verified against the npm registry:

| Package | Latest | Peer NDK | Backend | Fits NDK 3.0.3? |
|---|---|---|---|---|
| `@nostr-dev-kit/ndk-cache-redis` | 2.1.30 | v2.12.1 | ioredis | no (v2) |
| `@nostr-dev-kit/ndk-cache-sqlite` | 3.0.0 | v2.x | better-sqlite3 | no (v2) |
| `@nostr-dev-kit/cache-redis` (v3 name) | ~0.1.x | v3 beta | ioredis | early/beta |
| `@nostr-dev-kit/cache-sqlite` (v3 name) | recent | v3 | better-sqlite3 | yes, but server-NDK only |

   The app is on `@nostr-dev-kit/ndk@3.0.3`. The v3-era adapter drops the `ndk-` prefix (`cache-sqlite`, `cache-redis`). Both are server-side, and both still only help an NDK instance, which the SSR path does not have.

## Decision: lean SQLite, in two tiers

Keep the browser Dexie cache as-is. For the server, use SQLite as a plain read-through TTL cache (not an NDK adapter), and reserve the NDK `cache-sqlite` adapter for the future Node indexer.

### Tier 1 (near-term): a SQLite TTL cache around the hot SSR reads

A tiny key/value cache wrapping `fetchDiscoverBoards` first (highest value), then `fetchBoardSnapshot`:

- **Schema:** `cache(key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)`. `key` = function name + args (coordinate + the sorted relay set, the same key the React `cache()` already builds). `value` = the JSON snapshot.
- **Read-through:** on call, `SELECT ... WHERE expires_at > now`; a hit parses and returns; a miss runs the existing `SimplePool` fetch, then does `INSERT OR REPLACE` with a short TTL (discover ~60-120s, board ~30-60s) and returns. Sits between the page and the existing `*Impl` functions in `server.ts`.
- **Engine:** prefer Node's built-in `node:sqlite` (Node 22+) to avoid a native dependency; fall back to `better-sqlite3` only on an older runtime. Both are synchronous and local-disk fast; the single Next server process has no concurrency concern.
- This is plain SQLite, no NDK, no new relay logic.

Why this shape: the cache is purely an optimization (every value is re-derivable from relays), so durability and cross-machine sharing are not required. That is exactly what makes SQLite a clean fit and Redis overkill.

### Tier 2 (designed): NDK + cache-sqlite in a Node indexer

[INDEXER.md](./INDEXER.md) names the alternative to Cloudflare: "a Node service (Fly.io/Railway) running a long-lived NDK/SimplePool subscriber". If the indexer is ever built that way, `@nostr-dev-kit/cache-sqlite` (the NDK v3 server adapter, better-sqlite3 on a Fly volume) is the natural event store for that long-lived NDK instance. That is the one place the original suggestion lands correctly: the indexer, not the web SSR.

## Why SQLite over Redis here

- **No external service.** SQLite is embedded. Redis means standing up and paying for Upstash / Fly Redis and adding a network hop on every cache read.
- **Regenerable cache.** A miss just falls through to relays (the behavior today), so SQLite's single-node / per-machine nature is fine. Redis's shared, durable, HA properties are not needed.
- **Simplicity and speed.** `node:sqlite` (or better-sqlite3) is synchronous, local-disk fast, and trivially embeddable in the existing Next server.
- **Tradeoff accepted:** a SQLite cache is per-machine (a Fly volume attaches to a single machine, and the app runs ~2). Each machine warms its own cache. For a TTL cache that is acceptable: the worst case is a relay round-trip, identical to today. Redis would give one shared cache, but that gain does not justify an external dependency for regenerable data.

## Deployment constraints (root `fly.toml`)

- **Scale-to-zero** (`min_machines_running = 0`): in-memory caches die on idle. A SQLite file on ephemeral disk is wiped when the machine stops; on a Fly volume (`[[mounts]]`) it survives stop/start. Either is acceptable: ephemeral still cuts repeated reads while a machine is warm; a volume also survives cold starts.
- **~2 machines, single region (`fra`), 512 MB, shared CPU.** Volumes are per-machine/zone, hence the per-machine cache note above.
- **Native module:** if `better-sqlite3` is used (not `node:sqlite`), the standalone Docker build must bundle the compiled `.node` binary for the runtime platform. Preferring `node:sqlite` avoids this entirely.

## Recommendation

Not urgent: the client Dexie cache already covers repeat visitors, and cold SSR is the only real gap. When this is picked up:

1. **Tier 1:** add a `node:sqlite` read-through TTL cache around `fetchDiscoverBoards` (then `fetchBoardSnapshot`) in `apps/web/lib/nostr/server.ts`, behind an env flag, ephemeral disk first. Add a Fly volume only if cold-start hit-rate proves to matter.
2. **Do not** add the `ndk-cache-redis` / `ndk-cache-sqlite` (v2) packages.
3. **Reserve** `@nostr-dev-kit/cache-sqlite` for a future Node indexer per [INDEXER.md](./INDEXER.md).
