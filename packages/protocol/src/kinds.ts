/**
 * Nostr event kinds used by Voxboard, and the app-specific label namespaces / enums.
 * Authoritative mapping lives in docs/PROTOCOL.md. Keep these in sync with that doc.
 */

export const KIND = {
  /** NIP-01 user profile metadata */
  Metadata: 0,
  /** NIP-02 contact / follow list */
  Contacts: 3,
  /** NIP-09 deletion request (own events only) */
  Delete: 5,
  /** NIP-25 reaction: "+" upvote, "-" downvote */
  Reaction: 7,
  /** NIP-22 comment: idea (top-level post) AND threaded reply */
  Comment: 1111,
  /** NIP-32 label: status + pin/lock/hide/ban (owner/mod authored) */
  Label: 1985,
  /** NIP-72 moderator post approval (curated boards) */
  PostApproval: 4550,
  /** NIP-57 zap request */
  ZapRequest: 9734,
  /** NIP-57 zap receipt (from the LNURL server) */
  ZapReceipt: 9735,
  /** NIP-65 relay list metadata (outbox) */
  RelayList: 10002,
  /** NIP-51 follow set (optional extended member roster) */
  FollowSet: 30000,
  /** NIP-51 bookmark set (optional ordered roadmap column) */
  BookmarkSet: 30003,
  /** NIP-72 community definition = a board (addressable) */
  Community: 34550,
  /** NIP-42 relay auth (ephemeral, never stored) */
  ClientAuth: 22242,
  /** NIP-46 remote signer transport (ephemeral) */
  NostrConnect: 24133,
  /** NIP-89 handler information */
  HandlerInformation: 31990,
} as const;

export type Kind = (typeof KIND)[keyof typeof KIND];

/**
 * Reverse-DNS namespaces for the NIP-32 (kind 1985) labels we author.
 * Honored only when the label is authored by the board owner or a moderator (see docs/PROTOCOL.md).
 */
export const LABEL_NS = {
  status: "app.nostr-userinput.status",
  pin: "app.nostr-userinput.pin",
  lock: "app.nostr-userinput.lock",
  moderation: "app.nostr-userinput.moderation",
} as const;

/** The 9-state status taxonomy, ported verbatim from userinput.app. Order is meaningful. */
export const STATUS = [
  "open",
  "under-review",
  "backlog",
  "planned",
  "in-progress",
  "implemented",
  "declined",
  "duplicate",
  "closed",
] as const;

export type Status = (typeof STATUS)[number];

/** Statuses surfaced as roadmap kanban columns (subset of STATUS, in column order). */
export const ROADMAP_COLUMNS: readonly Status[] = [
  "open",
  "under-review",
  "backlog",
  "planned",
  "in-progress",
  "implemented",
] as const;

/** Human labels for each status. */
export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  "under-review": "Under review",
  backlog: "Backlog",
  planned: "Planned",
  "in-progress": "In progress",
  implemented: "Implemented",
  declined: "Declined",
  duplicate: "Duplicate",
  closed: "Closed",
};

/** Values used in the `moderation` label namespace. Each action carries an off-state so an owner/mod
 *  can reverse it with a later label (mirrors pin/unpin), instead of the action being permanent. */
export const MODERATION = {
  hidden: "hidden",
  unhidden: "unhidden",
  banned: "banned",
  unbanned: "unbanned",
} as const;

/** Per-board posting modes carried on the community definition. */
export const MODERATION_MODE = {
  open: "open",
  curated: "curated",
} as const;

export type ModerationMode = (typeof MODERATION_MODE)[keyof typeof MODERATION_MODE];

export function isStatus(value: string): value is Status {
  return (STATUS as readonly string[]).includes(value);
}
