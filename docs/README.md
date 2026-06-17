# Voxboard documentation

Voxboard is a Nostr-native public feedback board: users post ideas, vote, comment, and zap, and owners run
boards with moderation, a status workflow, and a roadmap. It is built with Next.js 16 (App Router),
Tailwind v4, and NDK. These docs describe the protocol model, the stack, and the supporting services.

## Index

| Doc | What it covers |
|---|---|
| [PROTOCOL.md](./PROTOCOL.md) | The Nostr event model: every concept (board, idea, reply, vote, status, moderation, zap) mapped to a kind and tag shape, with full event JSON. |
| [STACK.md](./STACK.md) | Pinned library versions, the NDK v2/v3 split, and the Next.js-for-Nostr patterns (thin server shell, fat client app). |
| [INDEXER.md](./INDEXER.md) | The aggregator that maintains authoritative vote counts, status, zap totals, and Web-of-Trust ranking. |
| [ATTESTATION.md](./ATTESTATION.md) | Platform attestation: filtering discover to vouched boards via an issuer-signed allowlist set and per-board labels. |
| [CACHING.md](./CACHING.md) | The server-side read-cache strategy, and why it leans on SQLite. |

## Core decisions

- **Protocol:** Nostr. Boards are NIP-72 moderated communities (kind 34550); ideas and replies are NIP-22 comments (kind 1111). NIP-72 is marked "unrecommended" (in favor of the relay-controlled NIP-29); Voxboard stays on it deliberately for a non-custodial, owner-signed, portable model (see [PROTOCOL.md](./PROTOCOL.md)).
- **Identity / signing:** NIP-07 extension, NIP-46 remote signer, and NIP-05 handles, with nsec paste as a power-user fallback. Keys stay client-side.
- **Nostr-native primitives:** profiles (kind 0), votes (NIP-25 reactions), follows (NIP-02), relay routing (NIP-65 outbox), zaps (NIP-57).
- **Framework:** Next.js 16 App Router, a thin server shell for SEO/OG/NIP-05 and a fat client app for the relay and signer logic. TypeScript, strict.

## Conventions

- No em dashes in docs, comments, or copy (use commas, parentheses, colons).
- Library versions live in [STACK.md](./STACK.md); reference them, do not restate them elsewhere.
