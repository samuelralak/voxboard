# Protocol decision: why NIP-72

Status: accepted, 2026-06-18. Voxboard's boards are NIP-72 moderated communities (kind 34550). This
records the reasoning: what the product requires, the threat model, the two real gaps in NIP-72, and how
we handle them. It is meant to be read as the call an engineer made, gaps and all, not a justification
written after the fact. For the event model itself (kinds, tags, JSON), see [PROTOCOL.md](./PROTOCOL.md).

## What Voxboard requires from a protocol

Ranked, because the ranking is what forces the choice.

1. **Owner-controlled, not relay-controlled.** A board belongs to the key that created it, not to whatever
   relay hosts it. Moderation authority is the owner plus the moderators they name, enforced by signature
   at read time.
2. **Portable and non-custodial.** A board and its posts are signed events readable from any relay. No
   single relay is load-bearing: if one disappears, the board and its posts can be re-served elsewhere and
   a user keeps their data.
3. **Post-and-vote shaped, not chat shaped.** The loop is: post an idea, others vote and comment, the
   owner sets status. Read-heavy, durable, ranked. Not ephemeral messaging.
4. **Aggregatable.** Vote totals, statuses, and zap totals must be computable from public events by any
   client and an indexer that all agree on.
5. **Reasonable interop.** An idea should be a normal Nostr event (kind 1111 comment) other clients can at
   least read, not a Voxboard-only encoding.

Not required: relay-enforced membership, closed/private groups, real-time chat, a single canonical host.
Those absences matter, because they are exactly what would point at a different protocol.

## The candidates

| | NIP-72 (moderated communities) | NIP-29 (relay-based groups) | Custom kind |
|---|---|---|---|
| Authority | owner's key (req 1) | the relay | owner's key |
| Portability | yes (req 2) | bound to the host relay | yes |
| Shape | posts + approval (req 3) | membership + messages | whatever we define |
| Interop | kind 1111 comments (req 5) | NIP-29 clients only | none |
| Write-time spam gate | none (gap 2) | relay enforces it | none |

NIP-29 fails requirements 1 and 2 by design: the relay is the authority and the group is bound to it.
That is right for chat and closed groups, wrong for a portable, owner-owned feedback board. A custom kind
would meet 1 to 3 but throw away interop and existing NIP-72 tooling to re-derive the same thing. NIP-72
is the only candidate that meets 1, 2, 3, and 5. So the decision is: pick the protocol whose authority and
portability model match the product, and pay for its weaknesses deliberately (below) instead of adopting a
model that contradicts the product to get spam control for free.

## Threat model

Who attacks a public feedback board, and how:

- **Spam flood:** an attacker publishes thousands of kind-1111 posts tagged to a board.
- **Sybil voting:** an attacker spins up keys to inflate or deflate vote counts.
- **Forged moderation / impersonation:** an attacker forges approvals, statuses, or bans.
- **Relay omission or injection:** a relay drops real posts or serves fake ones.

Out of scope: confidentiality (boards are public by design) and DoS of the relays themselves.

## The two real gaps

NIP-72 is silent on two things, and the silence is the honest weakness.

### Gap 1: relay routing is advisory, not guaranteed

NIP-72 lets a board carry `relay` tags marked `author` / `requests` / `approvals`, all optional ("MAY").
Nothing says where a post MUST be written or where a reader MUST look, so completeness is not guaranteed:
a post written only to a relay the reader does not query is invisible.

What Voxboard does today: it parses those markers (`packages/protocol/src/board.ts`) but routes reads off
the board link's `naddr` relay hints plus a default relay set, and queries everything (board, posts, votes,
labels, approvals) from that one set; per-author events use NIP-65 outbox. That works because Voxboard is
the primary client and controls where it writes, so everyone converges on the same relays. It is
app-mediated correctness, not protocol-guaranteed correctness, and it would break for a third-party client
that posts elsewhere.

How we close it: actually use the markers. Publish a board's posts to, and read them from, the relays the
board declares (`requests` / `approvals`), so the relay set is a property of the board that any conforming
client converges on, not a property of one app's defaults.

### Gap 2: there is no write-time spam gate

NIP-72 has no access control. Anyone can publish a post tagged to any community; nothing in the protocol
stops it. Every control NIP-72 (and Voxboard) has is display-side:

- **Curated boards** (`moderation_mode: curated`): a post renders only after an owner or moderator approves
  it with a kind-4550 event (`packages/protocol/src/approval.ts`). Spam never shows, but a human approves
  every post, so it does not scale to a busy open board.
- **Open boards** (default): everything renders, with reactive owner/mod hide and author ban (kind-1985
  labels, honored only from authorized keys) and a Web-of-Trust weighting that surfaces votes from accounts
  you follow alongside the raw score. Sybil votes are dampened, not prevented.
- **Platform attestation** gates the discover directory (which boards appear), not posts inside a board.

None of this stops publication. The spam still lands on the board's relays; we only stop it from being
shown.

How we close it: this is the part NIP-72 deliberately leaves to relay choice, and it is the tradeoff we
took on purpose. A board's relays (the `requests` relays from Gap 1) can enforce a write policy: allowlist,
payment, proof-of-work, or WoT. The owner keeps identity authority (their key signs the board); the relay
enforces write admission. That is NIP-72's native answer to flooding, and it is why we did not move to
NIP-29: NIP-29 gets write-gating by making the relay own the group; NIP-72 lets us gate writes at the relay
while keeping the owner as the root of trust. The cost is operational, someone runs or chooses gated
relays. Until a board actually faces spam, open boards run best-effort on curated mode plus WoT plus
reactive moderation, which is adequate at feedback-board scale.

## Forgery and sybil (these NIP-72 handles)

Because they reduce to signatures:

- Moderation (status, pin, lock, hide, ban) and approvals are honored only from the owner or a moderator
  named in the kind-34550 `p` tags, checked by signature at read time (`isAuthorized`). A forged action
  from a random key is ignored.
- Deletions are NIP-09 and apply only to one's own events.
- Vote counts dedupe to latest-per-pubkey, and sybil inflation is countered by the WoT-weighted read shown
  next to the raw number, never replacing it.

Relay omission and injection are mitigated by reading from several relays and re-verifying signatures
client-side. They are not fully solved without the Gap 1 routing fix.

## When we would reconsider

The choice is requirement-driven, so it flips if the requirements do:

- If boards must be closed, membership-gated, or relay-governed: that is NIP-29, and we accept
  relay-as-authority.
- If open boards routinely face spam that curated mode plus gated relays cannot hold: revisit, possibly
  NIP-29 or a stricter custom-relay design.
- If NIP-72 is retired rather than just unrecommended: migrate the board kind, keeping the general
  primitives (1111, 7, 1985, 57), which are unaffected by NIP-72's status.

## Status note

NIP-72 was marked "unrecommended" (pointing to NIP-29) on 2026-05-31, after Voxboard adopted it. We
reviewed the change and chose to stay, for the reasons above. NIP-29's relay-authority model is the wrong
tradeoff for a non-custodial, portable board; NIP-72's mechanisms remain fully specified and functional.
