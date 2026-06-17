# Voxboard web

The Voxboard web app: a Next.js 16 (App Router) server shell for SEO, Open Graph, and NIP-05, plus a
client app that handles relays, signing, and live subscriptions through NDK.

## Develop

```sh
npm install            # from the repo root
npm run dev -w web     # http://localhost:3000
```

Requires Node 22+. Scripts (`npm run <script> -w web`): `dev`, `build`, `start`, `lint`, `typecheck`,
`test`, `e2e`.

## Layout

- `app/` routes: home `/` and `/discover`, board `/b/[naddr]`, idea `/d/[nevent]`, profile `/o/[handle]`, and the `/.well-known/nostr.json` NIP-05 endpoint.
- `components/` the board, idea, auth, and shared UI components.
- `hooks/` relay subscriptions and derived state (votes, zaps, moderation, Web-of-Trust).
- `lib/nostr/` the server read path (request-scoped `SimplePool` snapshots) and the client NDK setup.

Protocol logic (event builders, parsers, read-time aggregation) lives in `@voxboard/protocol`
(`packages/protocol`). See [docs/](../../docs/) for the protocol model and architecture.

## Next.js 16

This app targets Next.js 16, which differs from earlier versions. See [AGENTS.md](./AGENTS.md) and the
local guides under `node_modules/next/dist/docs/` before writing Next-specific code.
