# STACK.md — Verified tooling, versions, and Next.js-for-Nostr patterns

All versions verified against npm during research (mid-June 2026). This is the single place version
numbers live; other docs reference, not restate. Re-verify at install time (these libraries release often).

## Pinned versions

| Package | Version | Notes |
|---|---|---|
| `next` | `16.2.9` | App Router. Turbopack is the default bundler. React 19. |
| `react` / `react-dom` | `19.2.x` | Required by Next 16. |
| `typescript` | `>=5.1` | strict mode on. |
| `tailwindcss` | `4.x` | CSS-first config via `@theme` (matches the original's Tailwind v4). |
| `@nostr-dev-kit/ndk` | `3.0.3` | core. Outbox model ON by default. |
| `@nostr-dev-kit/react` | `1.3.13` | **canonical v3 React hooks** (NOT `ndk-hooks`). |
| `@nostr-dev-kit/cache-dexie` | `2.7.8` | IndexedDB cache (v3-aligned). |
| `nostr-tools` | `2.23.5` | **peerDependency of ndk v3 — must install explicitly.** Used for server-side reads + low-level sign/verify/nip19/nip44. |
| `zustand` | `^5` | transitive via @nostr-dev-kit/react. |

Node: 22+ (Next needs 20.9+, but Node 22+ gives native `WebSocket` for server-side relay fetches).

### CRITICAL gotcha: the NDK v2/v3 split

The ecosystem is mid-migration. **Do NOT install** `@nostr-dev-kit/ndk-hooks` (pins ndk ^2.15) or
`@nostr-dev-kit/ndk-cache-dexie` (pins ndk 2.15.2). Mixing v2 and v3 puts two copies of ndk in the tree,
breaking `instanceof` checks and creating duplicate singletons. Use the v3 trio: `ndk@3` +
`@nostr-dev-kit/react@1.3.x` + `@nostr-dev-kit/cache-dexie@2.7.x`. After install, run
`npm ls @nostr-dev-kit/ndk` and confirm a single 3.x resolution (add `overrides` if a transitive dep drags v2 in).

## NDK v3 API surface (verified signatures)

```ts
import NDK, { NDKEvent, NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner, NDKKind } from '@nostr-dev-kit/ndk'
import NDKCacheAdapterDexie from '@nostr-dev-kit/cache-dexie'

let cacheAdapter: NDKCacheAdapterDexie | undefined
if (typeof window !== 'undefined') cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'nostr-userinput' })

const ndk = new NDK({
  explicitRelayUrls: ['wss://relay.primal.net', 'wss://nos.lol', 'wss://purplepag.es'],
  cacheAdapter,
  enableOutboxModel: true,
  aiGuardrails: process.env.NODE_ENV !== 'production', // dev only
})
if (typeof window !== 'undefined') ndk.connect()
```

Signers (v3 changed NIP-46 to static factories):
```ts
const ext   = new NDKNip07Signer()                                  // extension
const local = NDKPrivateKeySigner.generate()
const remote = NDKNip46Signer.bunker(ndk, 'bunker://<pubkey>?relay=...&secret=...', local)
await remote.blockUntilReady()
const nsec  = new NDKPrivateKeySigner('nsec1...')                   // pass nsec string directly, do NOT nip19.decode first
```

Subscriptions (3-arg form, handlers as 3rd arg):
```ts
ndk.subscribe(
  { kinds: [1111], '#A': ['34550:<owner>:<slug>'] },
  { closeOnEose: false },
  { onEvent: (e) => {}, onEvents: (batch) => {/* instant from cache */}, onEose: () => {} }
)
```

Publishing:
```ts
const e = new NDKEvent(ndk, { kind: 1111, content, tags })
await e.sign()
await e.publish()                  // addressable kinds: e.dTag = '...'; await e.publishReplaceable()
```

React hooks (`@nostr-dev-kit/react` 1.3.13):
`useNDK()`, `useNDKInit()`, `useSubscribe(filters | false, opts?, deps?) => { events, eose }`,
`useEvent(idOrFilter | false) => T | null | undefined`, `useProfileValue(pubkeyOrUser)`,
`useNDKCurrentUser() => NDKUser | null`, `useNDKSessionLogin()`, `useNDKSessionLogout/Switch`,
component `NDKHeadless`, class `NDKSessionLocalStorage`. Profiles use `picture` (`image` is deprecated).

## nostr-tools (server + low-level)

Use deep subpath imports (tree-shakes via `"sideEffects": false`):
```ts
import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
// Node < 22: useWebSocketImplementation(WebSocket-from-ws). Node 22+ has global WebSocket.
const pool = new SimplePool()
const events = await pool.querySync(relays, { kinds: [1111], '#A': [coord] }) // one-shot, request-scoped
pool.close(relays)
```
Notes: pool `subscribe`/`querySync` take a SINGLE `Filter` (not array); `publish` returns an array of
promises (use `Promise.any`). `nip19.decode('nsec...').data` is a `Uint8Array`; `decode('npub...').data` is hex.

## Next.js 16 patterns for a relay app

The rule: **thin server shell (SEO/OG/NIP-05), fat client app (relay + signer)**. See [PLAN.md](./PLAN.md)
for the route tree.

1. **`'use client'` does not stop SSR.** Client Components are still server-prerendered to HTML, so any
   code touching `window.nostr`, NDK, IndexedDB, or a WebSocket must be guarded with
   `typeof window !== 'undefined'` and run inside `useEffect`/event handlers, never at module top level
   on the server. For hard browser-only widgets, `next/dynamic(() => import(...), { ssr: false })`
   (allowed only inside a Client Component).
2. **Provider:** one client `NostrProvider` mounting a module-level NDK singleton + `NDKHeadless` +
   `useNDKInit` in `useEffect`, placed in the root layout so the relay connection and session persist
   across navigations. React Context is unavailable in Server Components, so the provider is a Client
   Component that accepts `children` (server-rendered children pass through as RSC output).
3. **Async dynamic APIs:** in Next 16 `params`, `searchParams`, `cookies`, `headers`, `draftMode` are
   all `Promise`s — `await` them. This includes `opengraph-image.tsx` params.
4. **SEO/OG:** `generateMetadata` (await params, read a cached server snapshot) + colocated
   `opengraph-image.tsx` using `ImageResponse` from `next/og` on the board and idea routes. This is the
   capability a Vite SPA cannot match and where we beat the original.
5. **NIP-05:** `app/.well-known/nostr.json/route.ts` GET handler. Lowercase hex pubkeys,
   `Access-Control-Allow-Origin: *`, NO redirects.
6. **Server snapshots for first paint:** a request-scoped `SimplePool.querySync` wrapped in `use cache`
   (`cacheLife` minutes, `cacheTag` = board handle), passed as an unresolved Promise into a Client
   Component and unwrapped with the React `use` hook under `<Suspense>`; the live NDK subscription then
   supersedes it. Pass only plain JSON events across the cache boundary (NDK instances are not serializable).
7. **`cacheComponents: true`** in `next.config.ts` (this is PPR in Next 16: static shell streams
   immediately, dynamic holes fill via Suspense). Dynamic is default; opt into caching with `use cache`.
   `generateStaticParams` must return at least one param (seed a few featured boards; `dynamicParams: true`
   renders the long tail on demand).
8. **No Server Actions for writes.** There is no DB and signing is client-side, so a Server Action cannot
   sign or publish. Reserve server work for read-only relay snapshots, cache revalidation, OG, and NIP-05.
9. **Fencing:** `import 'server-only'` in server relay modules, `import 'client-only'` in signer/NDK
   modules, so NDK/Dexie/signers never enter the server bundle and no secret leaks to the client.
10. **Deploy:** Vercel or any Node host works (relay WebSockets are browser-to-relay, so Vercel's
    no-WS-server limit is irrelevant). The vote-aggregation indexer, if/when added, runs as a SEPARATE
    always-on process (Fly.io/Railway/Cloudflare DO), never inside the Next request lifecycle.

## Next.js MCP (agent tooling)

Next.js 16 ships a built-in **MCP server** ("Next.js MCP Server" v0.2.0), served by `next dev` over
**Streamable HTTP** at `http://localhost:3000/_next/mcp` (enabled by default in dev; the dev port is
pinned to 3000 in `apps/web` so the URL is stable). Tools it exposes: `get-routes`, `get-errors`,
`get-logs`, `get-project-metadata`, `get-page-metadata`, `get-server-action-by-id`.

Wired into Claude Code via project-scoped `.mcp.json` at the repo root:
```json
{ "mcpServers": { "nextjs": { "type": "http", "url": "http://localhost:3000/_next/mcp" } } }
```
To use it: (1) run `npm run dev` (the MCP only exists while the dev server runs); (2) reload Claude Code
so it loads `.mcp.json` and approve the project MCP server when prompted; then `mcp__nextjs__*` tools
appear. Next 16 also ships its full docs locally at `node_modules/next/dist/docs/` (`01-app`,
`03-architecture`, etc.) and `AGENTS.md` warns this version differs from training data: consult those
(or the MCP) before writing Next-specific code.

## Media

Image attachments upload to a NIP-96 / Blossom media server (authenticated with NIP-98), URLs go into
the idea's `imeta` tags + content. v1 can start with a single configured media host; relay-agnostic.
</content>
