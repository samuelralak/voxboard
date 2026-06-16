# INDEXER.md — Voxboard Aggregator

Built **up front** (M1), not deferred. Nostr has no on-protocol vote total: reactions (kind 7) are
append-only and unauthenticated, so authoritative counts, sorting, status, and zap totals require an
aggregator that subscribes to the network, dedupes, and serves the result. This is that service.

## Why it exists

- **Vote counts:** dedupe kind-7 reactions to latest-per-pubkey (a pubkey can publish many; `+`/`-` is a
  toggle), then score = upvotes - downvotes. No relay guarantees it returns all reactions, so the client
  alone cannot count reliably at scale.
- **Sort:** "Top" and "Trending" need a maintained tally; you cannot sort a roadmap by a number that
  does not exist on-protocol.
- **Status / moderation:** collapse kind-1985 labels to one current value per idea, honoring only labels
  authored by the board owner or a moderator (read [PROTOCOL.md](./PROTOCOL.md) trust model).
- **Zaps:** sum sats from kind-9735 zap receipts per idea/reply; compute top-zappers.
- **Web-of-Trust:** weight votes and rank anti-spam by social-graph distance (phase: M4/M5).

The write path never goes through here: clients sign and publish to relays directly. The aggregator is
**read-only** and **never holds keys**.

## Technology

Cloudflare **Worker + Durable Object + D1** (chosen for fit with the team's stack and because a Durable
Object is purpose-built for persistent, stateful WebSocket coordination):

- **Durable Object per board** (shard large boards if needed). Uses **hibernatable WebSockets** to hold
  a long-lived subscription to the board's relays (from the community's `relay` tags + NIP-65), so it
  survives idle without burning a connection.
- **DO SQLite storage** for hot per-board state (idea scores, statuses, zap totals, reply counts,
  pin/lock/hide/ban). **D1** for cross-board/global queries (discovery, trending across boards,
  WoT graph).
- A front **Worker** routes HTTP requests to the right board DO and serves the read API.

Alternative if we ever leave Cloudflare: a Node service (Fly.io/Railway) running a long-lived
NDK/SimplePool subscriber + Postgres. Same contract; swap the host. The API below is the stable surface.

## What it ingests (per tracked board, coordinate `34550:<owner>:<slug>`)

| Subscription | Purpose |
|---|---|
| `{"kinds":[1111],"#A":["<coord>"]}` | ideas + replies (the board tree) |
| `{"kinds":[7],"#e":[...idea/reply ids]}` | votes (dedupe latest-per-pubkey) |
| `{"kinds":[1985],"#a":["<coord>"]}` | status + pin/lock/hide/ban labels (keep only authorized authors) |
| `{"kinds":[4550],"#a":["<coord>"]}` | approvals (for curated boards) |
| `{"kinds":[9735],"#e":[...ids]}` | zap receipts (sum sats) |
| `{"kinds":[0],"authors":[...]}` | author profiles (for chips, WoT seeds) |
| `{"kinds":[10002],"authors":[...]}` | outbox relay lists (to widen subscriptions) |

**Verification:** recompute event id (canonical NIP-01 serialization) and check the Schnorr signature
(`nostr-tools/pure`, optionally `nostr-wasm`) before counting. Relays are untrusted. Honor NIP-09
deletions (kind 5) by hiding locally.

## Read API (stable contract the web app depends on)

Read-only JSON, CORS-enabled. Shapes live in `packages/protocol` so web + indexer share types.

```
GET /v1/board/:coord/ideas?sort=top|trending|new&status=&tag=&cursor=
    -> { ideas: [{ id, score, up, down, zapSats, replyCount, status, pinned, locked, hidden }], cursor }

GET /v1/idea/:id/stats
    -> { id, score, up, down, voters, zapSats, topZappers: [{pubkey, sats}], status, replyCount }

GET /v1/board/:coord/roadmap
    -> { columns: { planned: [ideaId...], "in-progress": [...], implemented: [...] } }

GET /v1/board/:coord/moderation
    -> { owner, moderators, banned: [pubkey...], hidden: [id...], mode: "open"|"curated" }
```

- The **Next server** reads these in `generateMetadata` / OG / board SSR (cached with `use cache`).
- The **client** reads them for instant counts, then live `useSubscribe` corrects in real time
  (the aggregator is the source of truth for totals; subscriptions keep the UI live between polls).

## Lifecycle

A board is "tracked" when first requested (lazy) or seeded (featured boards). The DO backfills history
on first track (paged `querySync`), then stays live. Cold boards hibernate. No board's keys or content
are mutated here; deleting the DO loses only the cache, which rebuilds from relays.

## Phasing

- **M1:** DO subscription + vote dedupe/score + status collapse + the ideas/stats/roadmap/moderation API.
- **M4:** zap totals + top-zappers; begin WoT scoring.
- **M5:** D1 cross-board trending, WoT vote-weighting at scale, backfill robustness, monitoring.
</content>
