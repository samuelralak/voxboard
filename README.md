# Voxboard

A Nostr-native public feedback board. Post ideas, vote, comment, and zap; run boards with moderation, a
status workflow, and a roadmap. Every post is a signed Nostr event you own.

Live: https://voxboard.space

## What it is

Voxboard is a public feedback board (in the spirit of Canny or Featurebase), built entirely on the Nostr
protocol. Boards are NIP-72 communities, ideas and replies are NIP-22 comments, votes are NIP-25
reactions, and tips are NIP-57 zaps. There is no custodial database of record: clients sign and publish
to relays, and the app aggregates the result at read time.

## Monorepo

| Path | What |
|---|---|
| `apps/web` | The Next.js 16 web app: a server shell for SEO/OG/NIP-05, plus the client relay and signer logic. |
| `apps/indexer` | The vote / status / zap aggregator (Cloudflare Worker + Durable Object). |
| `apps/attestation` | The platform attestation signer (a small Node service on Fly). |
| `packages/protocol` | Shared protocol library: event builders, parsers, and read-time aggregation, used by the web app and the services. |

## Develop

```sh
npm install
npm run dev -w web      # http://localhost:3000
```

Requires Node 22+. Common scripts (per workspace, via `-w <name>`): `dev`, `build`, `typecheck`, `test`.

## Documentation

See [docs/](./docs/) for the full reference:

- [Protocol: the Nostr event model](./docs/PROTOCOL.md)
- [Stack and Next.js-for-Nostr patterns](./docs/STACK.md)
- [Indexer (aggregator)](./docs/INDEXER.md)
- [Platform attestation](./docs/ATTESTATION.md)
- [Caching strategy](./docs/CACHING.md)
