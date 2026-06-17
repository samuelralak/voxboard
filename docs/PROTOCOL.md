# Protocol: the Nostr event model

This document defines how Voxboard maps to Nostr. Every concept (board, idea, reply, vote, status, moderation) corresponds to a Nostr kind and tag shape, shown here with full event JSON.

## atproto -> Nostr mapping (the shape)

Voxboard is a Nostr rebuild of an AT Protocol feedback board. The mapping:

| AT Protocol (source model) | This app (Nostr) |
|---|---|
| DID (`did:plc:...`) | pubkey (hex) / `npub` |
| Handle (`pckt.blog`) | NIP-05 identifier (`name@domain`) |
| PDS repo | the author's write relays (NIP-65 outbox) |
| `at://did/collection/rkey` strongRef | event id / `a` coordinate / `e` tag |
| `space` (board) | NIP-72 community, kind **34550** (addressable) |
| `discussion` (idea) | NIP-22 comment, kind **1111**, scoped to the community |
| `reply` | NIP-22 comment, kind **1111**, scoped to parent |
| `upvote` / `downvote` | NIP-25 reaction, kind **7** (`+` / `-`) |
| `status` (9 states) | NIP-32 label, kind **1985**, by owner/mod |
| `member` (moderator) | community `p` tag (role=moderator), NIP-72 native |
| `pin` / `lock` / `hide` / `ban` | NIP-32 labels, kind **1985**, by owner/mod |
| approval (optional) | NIP-72 post approval, kind **4550** |
| profile | kind **0** (NIP-01) |
| follow | kind **3** (NIP-02) |
| delete own item | kind **5** (NIP-09) |
| (new, native) zaps | kind **9734/9735** (NIP-57) |
| constellation/slingshot indexers | relays + a vote-aggregation indexer |

## Kind table (everything read/written)

| Kind | NIP | Class | Use |
|---|---|---|---|
| 0 | 01 | replaceable | user profile metadata |
| 3 | 02 | replaceable | contact/follow list |
| 5 | 09 | regular | deletion request (own events only) |
| 7 | 25 | regular | upvote (`+`) / downvote (`-`) |
| 1111 | 22 | regular | idea (top-level post) AND threaded reply |
| 1985 | 32 | regular | status + pin/lock/hide/ban labels (owner/mod) |
| 4550 | 72 | regular | optional moderator post-approval |
| 9734 | 57 | regular | zap request |
| 9735 | 57 | regular | zap receipt (from the LNURL server) |
| 10002 | 65 | replaceable | relay list (outbox routing) |
| 30000 | 51 | addressable | optional: extended member roster / banned set per board |
| 30003 | 51 | addressable | optional: ordered roadmap column / pinned set |
| 34550 | 72 | addressable | board (community definition) |
| 22242 | 42 | ephemeral | relay AUTH (never stored) |
| 24133 | 46 | ephemeral | NIP-46 remote-signer transport |

Addressable coordinate format: `kind:pubkey:d`. A board's stable id is
`34550:<owner-pubkey>:<board-slug>`, shareable as an `naddr` (NIP-19/NIP-21).

---

## Board = NIP-72 community (kind 34550)

Addressable, authored by the board owner. The owner pubkey is the root of trust; moderators are the
`p` tags with a `moderator` marker.

```json
{
  "kind": 34550,
  "pubkey": "<owner-pubkey>",
  "tags": [
    ["d", "<board-slug>"],
    ["name", "Acme feedback"],
    ["description", "Tell us what to build next."],
    ["image", "https://media.example/icon.png", "512x512"],
    ["p", "<moderator-pubkey>", "wss://relay.example", "moderator"],
    ["relay", "wss://relay.example", "requests"],
    ["relay", "wss://relay.example", "approvals"],
    ["relay", "wss://relay.example", "author"],

    // app-specific config (custom tags, ignored by other clients):
    ["t", "bug"], ["t", "feature"], ["t", "question"],
    ["moderation_mode", "open"]
  ],
  "content": ""
}
```

- `moderation_mode`: `open` (default, render all posts) or `curated` (only show kind-4550-approved
  posts). This is the per-board flexibility knob.
- Category tags use `["t", "<value>"]` so they are relay-indexable.

## Idea = top-level community post (kind 1111)

NIP-22 comment whose root scope (uppercase) AND parent scope (lowercase) both point at the community.
Content is plaintext (NIP-22 rule). Title is a `subject` tag; categories are `t` tags; images use
NIP-92 `imeta` (uploaded via NIP-96/Blossom, URL also inlined in content).

```json
{
  "kind": 1111,
  "pubkey": "<poster-pubkey>",
  "content": "It would help to export the roadmap as CSV. https://media.example/shot.png",
  "tags": [
    ["A", "34550:<owner-pubkey>:<board-slug>", "wss://relay.example"],
    ["K", "34550"],
    ["P", "<owner-pubkey>", "wss://relay.example"],
    ["a", "34550:<owner-pubkey>:<board-slug>", "wss://relay.example"],
    ["k", "34550"],
    ["p", "<owner-pubkey>", "wss://relay.example"],

    ["subject", "Export roadmap as CSV"],
    ["t", "feature"],
    ["imeta", "url https://media.example/shot.png", "m image/png", "alt Roadmap screenshot"]
  ]
}
```

- One subscription returns the whole board: `{"kinds":[1111],"#A":["34550:<owner>:<slug>"]}`
  (gives ideas + every reply; build the tree client-side from lowercase `e` tags).
- **Editing:** kind 1111 is append-only. Edit is done via NIP-09 delete + repost (a new idea id).
  If in-place edit that preserves votes/replies becomes a hard requirement, ideas switch to an
  addressable kind (see the decision at the bottom).
- On post, the client also self-upvotes, see kind 7 below.

## Reply = nested community comment (kind 1111)

Root scope (uppercase) stays the community; parent scope (lowercase) points at the idea or parent reply.

```json
{
  "kind": 1111,
  "pubkey": "<replier-pubkey>",
  "content": "Plus one, CSV and JSON both.",
  "tags": [
    ["A", "34550:<owner-pubkey>:<board-slug>", "wss://relay.example"],
    ["K", "34550"],
    ["P", "<owner-pubkey>", "wss://relay.example"],
    ["e", "<parent-idea-or-reply-id>", "wss://relay.example", "<parent-author-pubkey>"],
    ["k", "1111"],
    ["p", "<parent-author-pubkey>", "wss://relay.example"]
  ]
}
```

## Vote = NIP-25 reaction (kind 7)

Upvote `content: "+"`, downvote `content: "-"`. The target (`e`) MUST be the last `e` tag. Votes apply
to ideas and replies (both kind 1111).

```json
{
  "kind": 7,
  "pubkey": "<voter-pubkey>",
  "content": "+",
  "tags": [
    ["e", "<target-1111-id>", "wss://relay.example", "<target-author-pubkey>"],
    ["p", "<target-author-pubkey>", "wss://relay.example"],
    ["k", "1111"]
  ]
}
```

### The counting problem (central trade-off)

Reactions are append-only and unauthenticated. There is no on-protocol vote total. Strategy:

- **Dedupe to latest-per-pubkey** (a user can publish many kind-7s; keep their newest, treat `+`/`-`
  as a toggle/flip). Score = (`+` count) - (`-` count) over deduped voters.
- **Authoritative counts need aggregation.** Client-side aggregation over the board subscription works
  to moderate scale (cached in IndexedDB via NDK). At production scale, a separate always-on
  **indexer** (subscribes to all `#e` reactions for tracked ideas, dedupes, persists an integer score)
  serves the Next.js server for SSR/sort. Never trust a relay-returned count.
- **Sybil:** pubkeys are free. Rank by a Web-of-Trust-weighted score (logged-in / NIP-05 / social-graph
  distance) and show the raw reaction number separately.

## Status + moderation = NIP-32 labels (kind 1985), owner/mod authored

One unified primitive for status, pin, lock, hide, ban. **Honored only when authored by the board
owner or a moderator** (a pubkey in the community's `p`/moderator tags). Clients enforce this at read
time; latest-from-authorized-author wins per (target, namespace). Custom reverse-DNS namespaces.

Status (the 9-state enum):

```json
{
  "kind": 1985,
  "pubkey": "<owner-or-mod-pubkey>",
  "content": "Shipping in Q3.",
  "tags": [
    ["L", "app.nostr-userinput.status"],
    ["l", "in-progress", "app.nostr-userinput.status"],
    ["e", "<idea-id>", "wss://relay.example"],
    ["a", "34550:<owner-pubkey>:<board-slug>", "wss://relay.example"]
  ]
}
```

Values: `open | under-review | backlog | planned | in-progress | implemented | declined | duplicate | closed`.
For `duplicate`, add `["e", "<canonical-idea-id>", "<relay>", "duplicate-of"]`.

Other moderation labels (same shape, different namespace/value):

- **pin:** `["L","app.nostr-userinput.pin"]`, `["l","pinned",...]`, `e`=idea, `a`=board. Unpin = new label `unpinned` or NIP-09 delete.
- **lock:** `["L","app.nostr-userinput.lock"]`, `["l","locked",...]`, `e`=idea. The event `created_at` is the lock cutoff (replies after it are hidden).
- **hide:** `["L","app.nostr-userinput.moderation"]`, `["l","hidden",...]`, `e`=target, `a`=board.
- **ban:** `["L","app.nostr-userinput.moderation"]`, `["l","banned",...]`, `p`=banned-pubkey, `a`=board. (Hide that author's content + block posting in this board, enforced client/indexer-side.)

Roadmap columns are **derived**: group ideas by current status label. For manual ordering inside a
column, optionally a NIP-51 kind 30003 set (`d`=`roadmap-<status>`, ordered `e` tags) maintained by the owner.

Why labels over a custom addressable status kind: interoperable (1985 is a known kind, indexable by
`#l`/`#L`), trivially filtered by author, latest-wins. The addressable alternative gives exactly-one
current value and in-place edit but no interop. Labels win; revisit only if label churn hurts.

## Moderators / membership

- Primary: moderators are listed in the community (34550) `p` tags with the `moderator` marker. The
  owner edits the community event to add/remove them. This is NIP-72 native and needs no extra kind.
- Optional extended roster (if more than a handful of mods, or distinct `admin` vs `moderator`):
  a NIP-51 kind 30000 set per board (`d`=`<board-slug>-mods`).
- Trust resolution at read time: `authorized = {owner} ∪ {community.p[moderator]}`. Only honor
  status/pin/lock/hide/ban labels and 4550 approvals from `authorized`.

## Optional approval flow = NIP-72 (kind 4550)

Used only when a board sets `moderation_mode=curated`. A moderator publishes a 4550 referencing the
post; the client then only renders posts that have an approval from an authorized pubkey. The 4550
`content` carries the full stringified original post for resilience.

```json
{
  "kind": 4550,
  "pubkey": "<moderator-pubkey>",
  "tags": [
    ["a", "34550:<owner-pubkey>:<board-slug>", "wss://relay.example"],
    ["e", "<post-id>", "wss://relay.example"],
    ["p", "<post-author-pubkey>", "wss://relay.example"],
    ["k", "1111"]
  ],
  "content": "<full JSON of the approved kind-1111 post>"
}
```

## Identity, handles, sharing

- **Profiles:** kind 0 (`name`, `about`, `picture`, `nip05`, `lud16` for zaps, `banner`, `website`).
- **Handles:** NIP-05 (`name@domain`). The app serves `/.well-known/nostr.json` for its own board/org
  handles (lowercase hex pubkeys, `Access-Control-Allow-Origin: *`, no redirects). Verify a profile's
  `nip05` by matching the returned hex to the pubkey before showing a verified chip.
- **Relay routing:** NIP-65 outbox (kind 10002). Never hardcode one relay set. Read an author's events
  from their write relays; when publishing, also send to the read relays of every `p`-tagged recipient.
- **Share links:** `naddr` for a board (encodes the 34550 coordinate + relay hints), `nevent` for an
  idea/reply. Use these in share buttons and URLs.
- **Deep-link discovery:** publish a NIP-89 kind 31990 handler (with `k` tags for 34550 and 1111)
  so other clients can open the boards/ideas.

## Signing

One `Signer` interface, three implementations behind a React context (see [STACK.md](./STACK.md) for
exact NDK classes):

- **NIP-07** browser extension (`window.nostr`): primary web path.
- **NIP-46** remote signer: `bunker://` paste and `nostrconnect://` QR, for users without an extension.
- **nsec** private key: power-user fallback.

All signing is client-side only. Private keys never touch the server.

## Canonical query patterns

| Need | Filter |
|---|---|
| Whole board (ideas + replies) | `{"kinds":[1111],"#A":["34550:<owner>:<slug>"]}` |
| One idea's replies | filter the above by lowercase `e` tree, or `{"kinds":[1111],"#e":["<idea-id>"]}` |
| Votes for a set of ideas | `{"kinds":[7],"#e":[...ids]}` then dedupe latest-per-pubkey |
| Status/moderation for the board | `{"kinds":[1985],"#a":["34550:<owner>:<slug>"]}`, keep only authorized authors |
| Approvals (curated boards) | `{"kinds":[4550],"#a":["34550:<owner>:<slug>"]}` |
| A user's boards | `{"kinds":[34550],"authors":["<pubkey>"]}` |
| Discovery of boards | `{"kinds":[34550]}` across discovery relays (+ a seeded/featured list) |

## Decided: idea = kind 1111

Ideas are **NIP-72 kind 1111** (append-only, single-query, interoperable, renders in other Nostr
comment clients). Editing an idea is delete + repost (NIP-09 + new event); the UI warns that an edit
resets votes/replies. There is no addressable idea kind. Revisit only if edit-preserving-votes becomes
a hard requirement.
