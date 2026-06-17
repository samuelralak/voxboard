# Platform attestation (the strict-allowlist noise filter)

Production discover shows **only proper boards**, not the random or malformed `kind:34550` events that accumulate on public relays. Voxboard does this with **platform attestation**: a single platform key vouches for boards, and discover hard-filters to the vouched set. The shared encoding lives in `packages/protocol/src/attestation.ts`.

## Design at a glance

| Property | Choice |
| --- | --- |
| Carriers | **Both**: an addressable allowlist set (gate) **and** per-board labels (badge + anti-swap) |
| Namespace | `space.voxboard.attestation` (matches the domain + the NIP-05 anchor), env-scoped on read |
| Admission gate (anti-sybil) | **Automated on board creation**: a conforming board + an authenticated owner request auto-attests; reactive revoke for spam. Structured so a tighter gate (NIP-05 owner / fee / WoT) drops in later |
| Discover fail mode | **Last-known-good cache** on a transient fetch/verify failure (never a blank discover on a relay blip; a verifiably-empty set still shows nothing) |
| Issuer key trust | **NIP-05 indirection**: published at `voxboard.space/.well-known/nostr.json`, not hardcoded, so it rotates |
| Set kind | NIP-51 addressable set, **kind 30000, `d="attested"`**, disambiguated by `(author=issuer, d)` |
| Key custody | dedicated `ATTESTATION_PRIVATE_KEY` Fly secret, platform key **never a user key** |

## The two carriers

### 1. Allowlist set (the discover gate)

One addressable NIP-51 set, **kind 30000 with `d="attested"`**, authored by the platform issuer key. It lists every attested board coordinate as an `a` tag:

```
kind: 30000
tags:
  ["d", "attested"]
  ["L", "space.voxboard.attestation"]           # env-scoped (see below)
  ["l", "attested", "space.voxboard.attestation"]
  ["a", "34550:<owner>:<slug>"]                 # one per attested board
  ...
```

Addressable ⇒ **latest-wins**, so the newest version is the entire truth and a board is revoked simply by republishing the set **without** its coordinate (no deletion event needed). `fetchDiscoverBoards` re-verifies the issuer's signature SSR-side and filters the discover list to these coordinates.

### 2. Per-board label (badge + anti-swap)

A NIP-32 label (kind 1985) per board, pinning **both** the coordinate (`a`) and the **exact board event id** (`e`):

```
kind: 1985
tags:
  ["L", "space.voxboard.attestation"]
  ["l", "attested", "space.voxboard.attestation"]   # off-state: "delisted"
  ["a", "34550:<owner>:<slug>"]
  ["e", "<board-event-id>"]                          # the anti-swap pin
```

The `e` pin **auto-revokes** the moment a board is edited (new event id), so a board can't be attested clean and then have spam swapped in under the same coordinate. This drives the per-board "Attested by Voxboard" badge (`isBoardAttested` collapses to latest-from-issuer and requires the `e` to match the board's current event id).

Why both: the set is one fetch + one verify for the whole directory (cheap gate); the label is per-board, edit-sensitive, and discoverable *from the board page*. The signer keeps them in lockstep.

## Namespace + env scoping

Base namespace is `space.voxboard.attestation`. `attestationNamespace(env)` appends `.<env>` for any non-production env (e.g. `space.voxboard.attestation.staging`). The **full `["l", value, namespace]` tag is pinned on read**, so a staging issuer key's labels/sets can never validate in production. Callers pass the env they run in explicitly.

## Issuer key: custody, trust, rotation

- **Custody:** a dedicated 64-hex secret `ATTESTATION_PRIVATE_KEY` (with an optional operational fallback), read **only** inside one signer module behind a private accessor, never logged, never sent client-side. Storage is a Fly secret injected at runtime. The signer sits behind an interface so a later swap to KMS/HSM doesn't touch callers. It is the **platform's own key, never a user key**: the non-custodial invariant.
- **Trust (NIP-05 indirection):** publish the issuer pubkey at `voxboard.space/.well-known/nostr.json` under a reserved name (`"_"`). The client resolves it at runtime and treats only sets/labels authored by that key as authoritative. Optionally also ship the current pubkey as a build-time constant for first-paint SSR, but `nostr.json` is authoritative on rotation. Do **not** hardcode-only.
- **Rotation:** Nostr has no native key rotation (the pubkey *is* the identity). NIP-05 collapses rotation into a one-file edit on the TLS-protected domain Voxboard already controls: update `nostr.json` → redeploy → re-sign the set + labels under the new key (a backfill, since reads are issuer-scoped). **Do not use NIP-26** delegated signing (deprecated 2025-05-21).

## Environment contract

The signer service and the web app are configured independently, so these cross-app equalities MUST hold (production fails closed when the required vars are unset):

| Var | Read by | Meaning |
| --- | --- | --- |
| `ATTESTATION_PRIVATE_KEY` | signer | the issuer signing key (hex/nsec). Never on the web app. |
| `ATTESTATION_PUBKEY` | signer **and** web | the issuer pubkey. On the signer it is a fail-closed **self-check** (`createSigner` asserts the private key derives it); on the web app it is the value the discover filter + badge pin. **MUST equal `getPublicKey(ATTESTATION_PRIVATE_KEY)`.** Required in production on both. |
| `ATTESTATION_ENV` (fallback `NODE_ENV`) | signer **and** web | env-scoped namespace selector. **MUST match** across both, or the web app pins a different namespace than the signer writes and discover silently empties. |
| `ATTESTATION_PUBLIC_URL` | signer | the trusted origin for the NIP-98 `u` pin. Required in production. |
| `ATTESTATION_RELAYS` | signer | where the issuer publishes (must overlap the web app's `DEFAULT_RELAYS`). |
| `ATTESTATION_OPERATORS` | signer | comma-separated operator pubkeys (attest-any / revoke). |
| `ATTESTATION_OPERATOR_KEY`, `ATTESTATION_URL` | operator CLI | the operator's own key + the service base URL. |
| `NEXT_PUBLIC_ATTESTATION_URL` | web client | the service base URL the create/edit hook posts to (empty = attestation off). |

## Where the signer lives

The signer is a standalone Node/Fly service. It does **not** go in the Cloudflare DO indexer (unauthenticated, CORS `*`, holds no keys, so putting a private key there would be wrong). The three core modules use `nostr-tools/pure` (already used by the indexer for `verifyEvent`):

1. **`signer.ts`**: reads `ATTESTATION_PRIVATE_KEY` via a private accessor, exposes `issuerPubkey` and `sign(template) → finalizeEvent(template, sk)`.
2. **`attest.ts`** (the gate): fetch + `verifyEvent` the board, **conformance check** via the shared `parseBoard`, **admission gate** (automated on a valid authenticated owner request), idempotent per `(coordinate, eventId)`.
3. **`issue.ts`**: sign the per-board label AND recompute + republish the full allowlist set; on revoke, drop the `a` from the next set version and delete/supersede the label. Centralizing both here is what keeps the two carriers consistent.
4. **A NIP-98-authed trigger**: the privileged surface. Must be NIP-98 (kind 27235) + an operator allow-list **before it touches the key**. Reuses the `isSafeRelayUrl` SSRF gate for outbound relay fetches.

Conformance reuses the shared `@voxboard/protocol` `parseBoard`, so the signer and client never disagree on "is this a valid board." Persistence: an `attestation` table (which coords are attested, label event ids for revoke) on the indexer's SQLite-on-Fly-Volume.

## Automated admission (anti-sybil)

Anti-forgery is **cryptographic and total**: attestations are BIP-340 Schnorr signatures; without the key no valid set/label can be produced, and signatures can't be mauled (SUF-CMA). Authenticity reduces to key custody + the client verifying against the issuer pubkey resolved from `voxboard.space`.

Anti-sybil is **policy, not crypto**: a free pubkey only proves "the platform vouched," never "not a sybil." The gate lives in front of the signer:

- **Automated on board creation.** When a board is created through Voxboard, the create flow sends a **NIP-98-authed** request (signed by the board owner) to the signer. The signer verifies the board exists + conforms (`parseBoard`) + the requester owns it, then **auto-signs** the attestation. No human in the loop.
- **Limitation:** this filters non-Voxboard / malformed `kind:34550` noise out of discover, but a determined spammer making conforming-but-spammy boards through Voxboard would be auto-attested **until reactively revoked** (instant, via the set).
- **Tighter gates (compose later, don't replace):** NIP-05-verified board owner, a posting fee observed as a payment to the platform npub, or WoT distance. The conformance half of the gate stays regardless. `attest.ts` is structured so a gate drops in without reworking callers.

## Discover enforcement

The single chokepoint is **`fetchDiscoverBoards`** (`apps/web/lib/nostr/server.ts`); its only caller is `/discover`. The home page does not list boards; `fetchOrgBoards` (per-pubkey) is out of scope. The client/SSR **re-verifies** the signed set (never merely trusts a relay or the indexer):

1. Resolve issuer pubkey `P` from `voxboard.space/.well-known/nostr.json?name=_` (cache briefly).
2. Fetch the allowlist set `30000:P:attested` from relays.
3. **Re-verify:** `verifyEvent(set)` (recompute id + Schnorr) AND `set.pubkey === P` AND the set carries the env-scoped `["l","attested",ns]` (`verifyAttestationSet`).
4. Build the `Set<string>` of allowed coordinates (`attestedCoordinates`).
5. After the `latestBoards(events)` parse, filter to boards whose coordinate ∈ the set. O(n) with O(1) membership.

This is a **hard server-side filter**: default discover is default-deny. An optional separate "browse all / unverified" route may exist for power users.

**Fail mode (last-known-good):**
- `P` resolves and the set is verifiably **empty** → show nothing (the allowlist is genuinely empty).
- `P` or the set **can't be fetched/verified at all** (infra/relay failure) → fall back to a small cached last-known-good allowlist, rather than blanking discover (too strict) or showing everything (defeats the gate).

The board page renders the badge from a `{kinds:[1985], "#a":[coord], authors:[P]}` query verified the same way (`isBoardAttested`, which also enforces the `e`-pin anti-swap).

## Revocation

Three layered, in-spec mechanisms; `issue.ts` does all of them in one revoke op:

1. **Set (primary, authoritative):** omit the coordinate from the next set version. Addressable latest-wins = instant removal from discover, no deletion event.
2. **Label:** NIP-09-delete the kind-1985 label (NIP-32's recommended revoke) and/or publish a superseding `["l","delisted",ns]` label; read collapses to latest-from-issuer.
3. **Automatic:** the `e`-pin auto-revokes the badge on any board edit until re-attested.

## Hardening notes

The write path is hardened against relay-failure and concurrency footguns:

- **Blind-read guard:** the write path distinguishes a total relay outage (0 reachable relays) from a genuine empty and REFUSES to recompute the allowlist on a blind read, so an attest during an outage can never publish a shrunken set that supersedes the real one.
- **Monotonic created_at** on every republished label and set, so a same-second op or clock skew can't lose a tie (a delist always supersedes its attest; a republished set always supersedes the old one).
- **Publish failures fail closed** (`ok === 0` throws): a broadcast that reached no relay is never reported as a successful attest/revoke. Coordinates are canonicalized on parse (case-safe membership).
- **Single-writer assumption:** the set is a read-modify-write on an addressable event, assuming one serialized writer per issuer. Concurrent cross-instance ADDs can lose-update the set (labels still land; the next op / a reconcile heals it). A persistent store closes this.

The NIP-98 trigger is hardened: the `u` pin uses a trusted origin (prod REQUIRES `ATTESTATION_PUBLIC_URL`, never proxy headers); body binding is mandatory (no coordinate-swap replay); every request is crash-wrapped (an unhandled throw can't down the key-holding process), unexpected errors return a generic 500 and relay problems a typed 503, with `process` guards + tight timeouts.

The discover gate is proven sound: no forged or foreign set, and no non-attested board, passes. The masthead `AttestedBadge` is computed in the snapshot from a dedicated issuer-pinned label query and re-checked client-side against the displayed board version, so a client-side edit auto-revokes it.

## Component map

| Module | Role |
| --- | --- |
| `kinds.ts` | `ATTESTATION` + `attestationNamespace` protocol vocabulary |
| `attestation.ts` | pure builders/parsers + `verifyAttestationSet` / `collapseAttestationLabels` / `isBoardAttested` (shared by web + signer) |
| `apps/attestation/src/signer.ts` | reads `ATTESTATION_PRIVATE_KEY` in a closure (never exposed); exposes `issuerPubkey` + `sign()` via `nostr-tools/pure.finalizeEvent`; fails closed on a missing/malformed key or mismatched `ATTESTATION_PUBKEY` |
| `apps/web/lib/attestation.ts` + `/.well-known/nostr.json` route | publish the issuer pubkey under `_` from env (CORS `*`, rotation anchor) |
| `relays.ts` | responder-aware SimplePool client + `withRelayClient` |
| `attest.ts` | fetch + verify + conformance via shared `parseBoard` + a fail-closed owner/operator gate |
| `issue.ts` | sign label + recompute/republish set, idempotent |
| `buildHttpAuth` / `parseHttpAuth` / `sha256Hex` / `verifyHttpAuth` | NIP-98 (kind 27235) primitive + server-side verify (Schnorr + freshness + url + method + MANDATORY payload-hash body binding) |
| HTTP server | `POST /v1/attest` owner-or-operator authed, `POST /v1/revoke` operator-only; pure `handleRequest` core + thin Node wrapper. Operators via `ATTESTATION_OPERATORS` |
| `use-attest.ts` | web create/edit hook; fires fire-and-forget, signing a token bound to the body |
| `decideAllowlist` | the pure fail-mode policy |
| `fetchAllowlist` | re-verify the issuer-signed set SSR-side (envelope + Schnorr + issuer/namespace pin, with a reachability signal + last-known-good cache) |
| `fetchDiscoverBoards` | the strict discover filter (fetch by attested owners, keep exactly the attested coordinates) |
| `AttestedBadge` | masthead badge from a dedicated issuer-pinned label query, re-checked client-side |
| `apps/attestation/src/cli.ts` (run via tsx) | thin attest/revoke CLI; signs a NIP-98 token with the operator key and posts to the privileged endpoints |
| `apps/attestation/Dockerfile` | esbuild-bundled single-file runtime, ~280KB, no node_modules |
| `apps/attestation/fly.toml` | its own Fly app, scale-to-zero |
| `main.ts` + `npm run bundle` | entrypoint + bundle step; `NEXT_PUBLIC_ATTESTATION_URL` build arg wired into the web Dockerfile/fly.toml |

## Deploy runbook

Run from the repo ROOT. The actual `fly` commands + key custody are operator-run.

1. **Generate the platform issuer keypair** (keep the secret; you set it as a Fly secret, never commit it):
   ```sh
   nak key generate                 # prints a hex secret; nak key public <hex> for the pubkey
   # or: node -e "const {generateSecretKey,getPublicKey}=require('nostr-tools/pure');const {bytesToHex}=require('@noble/hashes/utils');const sk=generateSecretKey();console.log('SECRET',bytesToHex(sk));console.log('PUBKEY',getPublicKey(sk))"
   ```
2. **Create + configure the signer app** (`voxboard-attestation`):
   ```sh
   fly apps create voxboard-attestation
   fly secrets set -a voxboard-attestation \
     ATTESTATION_PRIVATE_KEY=<hex-or-nsec> \
     ATTESTATION_PUBKEY=<issuer-pubkey-hex> \
     ATTESTATION_OPERATORS=<your-operator-pubkey-hex>
   fly deploy --config apps/attestation/fly.toml --dockerfile apps/attestation/Dockerfile
   curl https://voxboard-attestation.fly.dev/      # health: { issuer, namespace }
   ```
   (If you use a custom domain, set `ATTESTATION_PUBLIC_URL` in `apps/attestation/fly.toml` to match it.)
3. **Enable the auto-attest hook on the web app** (build-time inline; does NOT yet gate discover):
   ```sh
   fly deploy -a voxboard --build-arg NEXT_PUBLIC_ATTESTATION_URL=https://voxboard-attestation.fly.dev
   ```
   New boards now auto-attest on create; existing boards attest when re-saved or via the CLI (step 4).
4. **Attest the existing real boards** with the operator CLI, so discover isn't empty when the gate flips:
   ```sh
   ATTESTATION_OPERATOR_KEY=<your-nsec> ATTESTATION_URL=https://voxboard-attestation.fly.dev \
     npm -w @voxboard/attestation run cli -- attest 34550:<owner>:<slug>
   ```
5. **Flip the discover gate on** (runtime secret; production discover now shows ONLY attested boards):
   ```sh
   fly secrets set -a voxboard ATTESTATION_PUBKEY=<issuer-pubkey-hex>
   ```
   Order matters: attest the backlog (steps 3–4) BEFORE this, or discover goes empty until boards attest.
6. **Moderate** anytime with the CLI: `... run cli -- revoke 34550:<owner>:<slug>` (operator-only).

Invariants (enforced/fail-closed): web `ATTESTATION_PUBKEY` == `getPublicKey(signer ATTESTATION_PRIVATE_KEY)`; web `NEXT_PUBLIC_ATTESTATION_URL` == signer `ATTESTATION_PUBLIC_URL`; web + signer `ATTESTATION_ENV` match.

## Risks

- The signer is a privileged, key-holding surface. **NIP-98 auth + operator allow-list must land in the same change as the trigger endpoint**, never after.
- Rotation forces a re-attest/backfill (reads are issuer-scoped). NIP-05 makes the *discovery* side a one-file edit; the *re-sign* side is real work. Keep it a runbook.
- Two-carrier consistency: the signer must keep set and labels in lockstep on every attest/revoke, or the badge and the gate disagree. Centralize both in `issue.ts`.
- Fail-mode footgun: too-strict empties discover on a blip; too-loose silently defeats the allowlist. Locked to last-known-good for this reason.
- Namespace/env scoping must actually be pinned on read (full `["l","attested",ns]` tag), or a staging key leaks into prod. Enforced by `parseAttestationSet`/`parseAttestationLabel`.

## Sources

- NIPs: 32 (labels + NIP-09 revoke), 51 (addressable sets, latest-wins), 05 (key↔domain + rotation), 72 (kind 34550, no native discovery), 98 (kind 27235 HTTP auth), 26 (deprecated, do not use).
- Crypto: BIP-340 Schnorr SUF-CMA (anti-forgery); `nostr-tools/pure` `finalizeEvent`/`verifyEvent`.
