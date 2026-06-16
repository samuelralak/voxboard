# nostr-userinput — Reference Docs (Source of Truth)

A production, Nostr-native rebuild of [userinput.app](https://userinput.app) (a Canny/Featurebase-style
public feedback-board) on the Nostr protocol, using Next.js 16 (App Router) + Tailwind v4 + TypeScript.

These docs are the **canonical reference** for the build. Whenever a decision changes, update the
relevant doc here first, then the code. Do not let code and docs drift: this folder is the contract.

## Index

| Doc | What it covers |
|---|---|
| [PRODUCT.md](./PRODUCT.md) | What userinput.app is, reverse-engineered: features, the 14-collection data model, routes, UX flows, visual language. The thing we are porting. |
| [PROTOCOL.md](./PROTOCOL.md) | **The Nostr event model.** Every product concept mapped to a kind + tags, with full event JSON. The most load-bearing doc: build against this, not memory. |
| [STACK.md](./STACK.md) | Verified library versions (Next 16.2.9, NDK 3.0.3, nostr-tools 2.23.5, etc.), Next.js-for-Nostr patterns, and the gotchas (esp. the NDK v2/v3 split). |
| [DESIGN.md](./DESIGN.md) | Design direction: editorial paper-and-ink, zaps as a second axis, Web-of-Trust, Linear-grade surface discipline. Feeds the frontend-craft work. |
| [INDEXER.md](./INDEXER.md) | The Voxboard Aggregator (Cloudflare Worker + Durable Object + D1): authoritative vote counts, status collapse, zap totals, WoT. Built up front. |
| [PLAN.md](./PLAN.md) | The build plan: architecture, milestones, file structure, and what ships in each phase. |
| [research-raw/](./research-raw/) | Raw research artifacts: on-chain lexicon dumps, page scrapes, screenshots, and the full multi-agent research output. Provenance for everything above. |

## Settled decisions (so we don't relitigate)

0. **Name:** Voxboard. **Idea = kind 1111. Vote-aggregation indexer built up front (M1). Zaps in v1 (M4).**
1. **Protocol:** Nostr (the original is AT Protocol / Bluesky; we port the same shape to Nostr).
2. **Backbone:** NIP-72 moderated communities (kind 34550), kept flexible (open posting by default,
   optional moderator approval per board).
3. **Identity / signing:** NIP-07 extension + NIP-46 remote signer + NIP-05 handles (nsec paste as a power-user fallback).
4. **Everything else Nostr-native:** profiles = kind 0, votes = NIP-25 reactions, follows = NIP-02,
   relay routing = NIP-65 outbox, plus NIP-57 zaps as a native upgrade.
5. **Framework:** Next.js 16 App Router (thin server shell for SEO/OG/NIP-05, fat client app for the relay/signer logic). Not a Vite SPA.
6. **Language:** TypeScript, strict.

## Global conventions

- No em dashes in any docs, comments, or copy (use commas, parentheses, colons).
- Keep verified version numbers in [STACK.md] only; reference them, do not re-state them elsewhere.
