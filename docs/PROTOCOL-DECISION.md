# Protocol decision: why NIP-72

Voxboard boards are NIP-72 communities (kind 34550). We adopted NIP-72 for its
fit and did not weigh the gaps below at the time; they were surfaced afterward. This records the reasoning
and the decision to stay. For the event model see [PROTOCOL.md](./PROTOCOL.md).

## Requirements

Ranked, because the ranking forces the choice.

1. **Owner-controlled.** A board belongs to the key that created it, not the relay hosting it. Moderation
   is the owner plus the moderators they name, enforced by signature.
2. **Portable.** Boards and posts are signed events readable from any relay. No relay is load-bearing:
   lose one, re-serve elsewhere.
3. **Post-and-vote, not chat.** Post an idea, vote, comment, set status. Durable and ranked, not ephemeral.
4. **Aggregatable.** Vote totals, statuses, and zap totals are computable from public events by any client
   and indexer.
5. **Interop.** An idea is a normal kind-1111 comment other clients can read, not a Voxboard-only encoding.

Not required: relay-enforced membership, closed groups, real-time chat, a single host. Those absences pick
the protocol.

## Candidates

| | NIP-72 | NIP-29 | Custom kind |
|---|---|---|---|
| Authority | owner's key | the relay | owner's key |
| Portable | yes | bound to host relay | yes |
| Shape | posts + approval | membership + messages | ours to define |
| Interop | kind 1111 | NIP-29 clients only | none |
| Write-time spam gate | none (gap 2) | relay enforces | none |

- **NIP-29** fails requirements 1 and 2 by design: the relay is the authority, and the group is bound to it.
  Good for chat and closed groups, wrong for a portable, owner-owned board.
- **Custom kind** meets 1 to 3 but discards interop and existing tooling to rebuild the same thing.
- **NIP-72** is the only candidate that meets 1, 2, 3, and 5.

We keep NIP-72 and accept its weaknesses (next), rather than move to a model that contradicts the product to
get spam control for free.

## Threat model

- **Spam flood:** thousands of kind-1111 posts tagged to a board.
- **Sybil voting:** throwaway keys inflating or deflating counts.
- **Forged moderation:** fake approvals, statuses, or bans.
- **Relay omission or injection:** a relay drops real posts or serves fake ones.

Out of scope: confidentiality (boards are public) and DoS of relays.

## The two gaps

NIP-72 is silent on two things.

**Gap 1: relay routing is advisory.** A board MAY carry `relay` tags (`author` / `requests` / `approvals`),
but nothing says where a post must be written or read, so a post on a relay you do not query is invisible.

Voxboard parses the markers (`packages/protocol/src/board.ts`) but does not route by them; it centers on one
relay set instead:

- **Reads:** the board link's `naddr` hints, or the defaults if the link has none (`relaysOrDefault`). The
  SSR snapshot pulls the board, posts, votes, labels, and approvals from it; the live client adds NIP-65
  outbox for per-author data.
- **Writes:** the author's relays plus the app's default pool.

Both sides center on the same default relays, so they converge in practice, but as app-mediated correctness,
not protocol-guaranteed: a client that reads or writes elsewhere is missed.

Fix: route by the markers, so the relay set is a property of the board, not of one app's defaults.

**Gap 2: no write-time spam gate.** Anyone can post to any community; the protocol does not stop it. Every
NIP-72 control is display-side:

- **Curated boards:** a post shows only after an owner/mod approval (kind 4550, `packages/protocol/src/approval.ts`).
  Spam never shows, but each post needs a human, so it does not scale.
- **Open boards:** everything shows, with reactive hide/ban (kind-1985 labels from authorized keys) and a
  Web-of-Trust weighting beside the raw score. Sybils are dampened, not stopped.
- **Attestation** gates the discover directory, not posts within a board.

None of this stops publication, only display.

Fix: gate writes at the board's relays (allowlist, payment, proof-of-work, or WoT). The owner still signs
the board; the relay enforces admission. This is why we kept NIP-72 over NIP-29: NIP-29 gates writes by
making the relay own the group; NIP-72 lets the relay gate writes while the owner stays the root of trust.
Cost: someone runs or picks gated relays. Until a board is actually spammed, open boards run on curated mode
plus WoT plus reactive moderation.

## Forgery and sybil (handled)

These reduce to signatures:

- Moderation and approvals count only from the owner or a named moderator, checked at read time
  (`isAuthorized`). Forged actions are ignored.
- Deletions (NIP-09) apply only to your own events.
- Votes dedupe to latest-per-pubkey; the WoT-weighted read sits beside the raw count, never replacing it.

Relay omission and injection are mitigated by reading several relays and re-verifying signatures; fully
solved only with the Gap 1 fix.

## When we reconsider

- Boards must be closed or relay-governed: use NIP-29, accept relay-as-authority.
- Open boards face spam that curated mode plus gated relays cannot hold: revisit.
- NIP-72 is retired, not just unrecommended: migrate the board kind; the general primitives (1111, 7, 1985,
  57) are unaffected.

NIP-72 was already marked "unrecommended" (toward NIP-29) on 2026-05-31, about two weeks before we started,
and we did not catch it. Now that we have, the decision stands: NIP-29's relay-authority model is the wrong
tradeoff for a portable, non-custodial board, and the gaps above are addressable within NIP-72.
