/**
 * Moderation: pin / lock / hide / ban as NIP-32 labels (kind 1985), plus the read-time trust model.
 *
 * Authority is not server-enforced. A label only "counts" when authored by the board owner or a
 * moderator (a `p` tag on the community). Every client/the indexer resolves that set itself and
 * collapses labels to latest-from-authorized. See docs/PROTOCOL.md.
 */

import { KIND, LABEL_NS, MODERATION } from "./kinds";
import { communityCoordinate, type CommunityRef } from "./coords";
import type { Board } from "./board";
import type { StatusLabel } from "./status";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTags,
  now,
} from "./event";

// ---------------------------------------------------------------------------
// Generic label builder
// ---------------------------------------------------------------------------

interface LabelParts {
  namespace: string;
  value: string;
  e?: { id: string; relay?: string };
  p?: { pubkey: string; relay?: string };
  board?: CommunityRef;
  boardRelay?: string;
  content?: string;
  createdAt?: number;
}

function buildLabel(parts: LabelParts): EventTemplate {
  const tags: (string[] | undefined)[] = [
    ["L", parts.namespace],
    ["l", parts.value, parts.namespace],
  ];
  if (parts.e) tags.push(parts.e.relay ? ["e", parts.e.id, parts.e.relay] : ["e", parts.e.id]);
  if (parts.p) tags.push(parts.p.relay ? ["p", parts.p.pubkey, parts.p.relay] : ["p", parts.p.pubkey]);
  if (parts.board) {
    const coord = communityCoordinate(parts.board);
    tags.push(parts.boardRelay ? ["a", coord, parts.boardRelay] : ["a", coord]);
  }
  return {
    kind: KIND.Label,
    created_at: parts.createdAt ?? now(),
    tags: compactTags(tags),
    content: parts.content ?? "",
  };
}

function declaresNamespace(event: NostrEvent, namespace: string): boolean {
  return getTags(event.tags, "L").some((t) => t[1] === namespace);
}

function labelValue(event: NostrEvent, namespace: string): string | undefined {
  return event.tags.find((t) => t[0] === "l" && t[2] === namespace)?.[1];
}

function firstTagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

// ---------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------

export interface PinInput {
  target: { id: string; relay?: string };
  board: CommunityRef;
  boardRelay?: string;
  createdAt?: number;
}
export function buildPin(input: PinInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.pin,
    value: "pinned",
    e: input.target,
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
/** Unpin = a later label in the pin namespace with value "unpinned" (the off-state; also retractable). */
export function buildUnpin(input: PinInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.pin,
    value: "unpinned",
    e: input.target,
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
export interface PinLabel {
  pubkey: string;
  targetId: string;
  /** true for "pinned", false for the "unpinned" off-state */
  pinned: boolean;
  createdAt: number;
  raw: NostrEvent;
}
export function parsePin(event: NostrEvent): PinLabel | null {
  if (event.kind !== KIND.Label) return null;
  if (!declaresNamespace(event, LABEL_NS.pin)) return null;
  const value = labelValue(event, LABEL_NS.pin);
  if (value !== "pinned" && value !== "unpinned") return null;
  const targetId = firstTagValue(event, "e");
  if (!targetId) return null;
  return { pubkey: event.pubkey, targetId, pinned: value === "pinned", createdAt: event.created_at, raw: event };
}

// ---------------------------------------------------------------------------
// Lock (the event's created_at is the cutoff; replies after it are hidden)
// ---------------------------------------------------------------------------

export interface LockInput {
  target: { id: string; relay?: string };
  board?: CommunityRef;
  boardRelay?: string;
  createdAt?: number;
}
export function buildLock(input: LockInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.lock,
    value: "locked",
    e: input.target,
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
export interface LockLabel {
  pubkey: string;
  targetId: string;
  /** replies created at or before this (the label's created_at) are shown; later ones hidden */
  lockedAt: number;
  createdAt: number;
  raw: NostrEvent;
}
export function parseLock(event: NostrEvent): LockLabel | null {
  if (event.kind !== KIND.Label) return null;
  if (!declaresNamespace(event, LABEL_NS.lock)) return null;
  if (labelValue(event, LABEL_NS.lock) !== "locked") return null;
  const targetId = firstTagValue(event, "e");
  if (!targetId) return null;
  return {
    pubkey: event.pubkey,
    targetId,
    lockedAt: event.created_at,
    createdAt: event.created_at,
    raw: event,
  };
}

// ---------------------------------------------------------------------------
// Hide (an idea or a reply)
// ---------------------------------------------------------------------------

export interface HideInput {
  target: { id: string; relay?: string };
  board: CommunityRef;
  boardRelay?: string;
  createdAt?: number;
}
export function buildHide(input: HideInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.moderation,
    value: MODERATION.hidden,
    e: input.target,
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
/** Un-hide = a later moderation label valued "unhidden" (the off-state), so a hide is reversible. */
export function buildUnhide(input: HideInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.moderation,
    value: MODERATION.unhidden,
    e: input.target,
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
export interface HideLabel {
  pubkey: string;
  targetId: string;
  /** true for "hidden", false for the "unhidden" off-state */
  hidden: boolean;
  createdAt: number;
  raw: NostrEvent;
}
export function parseHide(event: NostrEvent): HideLabel | null {
  if (event.kind !== KIND.Label) return null;
  if (!declaresNamespace(event, LABEL_NS.moderation)) return null;
  const value = labelValue(event, LABEL_NS.moderation);
  if (value !== MODERATION.hidden && value !== MODERATION.unhidden) return null;
  const targetId = firstTagValue(event, "e");
  if (!targetId) return null;
  return { pubkey: event.pubkey, targetId, hidden: value === MODERATION.hidden, createdAt: event.created_at, raw: event };
}

// ---------------------------------------------------------------------------
// Ban (a pubkey, scoped to a board)
// ---------------------------------------------------------------------------

export interface BanInput {
  subject: string; // banned pubkey
  board: CommunityRef;
  boardRelay?: string;
  createdAt?: number;
}
export function buildBan(input: BanInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.moderation,
    value: MODERATION.banned,
    p: { pubkey: input.subject },
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
/** Un-ban = a later moderation label valued "unbanned" (the off-state), so a ban is reversible. */
export function buildUnban(input: BanInput): EventTemplate {
  return buildLabel({
    namespace: LABEL_NS.moderation,
    value: MODERATION.unbanned,
    p: { pubkey: input.subject },
    board: input.board,
    boardRelay: input.boardRelay,
    createdAt: input.createdAt,
  });
}
export interface BanLabel {
  pubkey: string; // author (must be owner/mod)
  subject: string; // banned pubkey
  /** true for "banned", false for the "unbanned" off-state */
  banned: boolean;
  createdAt: number;
  raw: NostrEvent;
}
export function parseBan(event: NostrEvent): BanLabel | null {
  if (event.kind !== KIND.Label) return null;
  if (!declaresNamespace(event, LABEL_NS.moderation)) return null;
  const value = labelValue(event, LABEL_NS.moderation);
  if (value !== MODERATION.banned && value !== MODERATION.unbanned) return null;
  const subject = firstTagValue(event, "p");
  if (!subject) return null;
  return { pubkey: event.pubkey, subject, banned: value === MODERATION.banned, createdAt: event.created_at, raw: event };
}

// ---------------------------------------------------------------------------
// Trust resolution + collapse
// ---------------------------------------------------------------------------

/** The set of pubkeys whose moderation actions are honored on a board: owner + moderators. */
export function resolveModerators(board: Board): Set<string> {
  const set = new Set<string>([board.pubkey]);
  for (const mod of board.moderators) set.add(mod.pubkey);
  return set;
}

export function isAuthorized(pubkey: string, board: Board): boolean {
  return pubkey === board.pubkey || board.moderators.some((m) => m.pubkey === pubkey);
}

interface Authored {
  pubkey: string;
  createdAt: number;
  raw: NostrEvent;
}

/**
 * Keep the latest label per key, considering only labels that are (a) authored by an authorized pubkey
 * AND (b) scoped to THIS board's coordinate (the label's `a` tag). The coordinate check stops an
 * owner/mod's label for a DIFFERENT board they run (or a forged/over-returned label) from leaking into
 * this board's status/pin/hide/ban sets; the relay `#a` filter is only advisory. Tiebreak on equal
 * created_at by lowest event id (NIP-01).
 */
function collapseLatest<T extends Authored>(
  labels: T[],
  authorized: Set<string>,
  boardCoordinate: string,
  key: (label: T) => string,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const label of labels) {
    if (!authorized.has(label.pubkey)) continue;
    if (firstTagValue(label.raw, "a") !== boardCoordinate) continue; // not scoped to this board
    const k = key(label);
    const prev = latest.get(k);
    if (
      !prev ||
      label.createdAt > prev.createdAt ||
      (label.createdAt === prev.createdAt && label.raw.id < prev.raw.id)
    ) {
      latest.set(k, label);
    }
  }
  return latest;
}

/** Current status per idea: latest authorized status label, keyed by target id. */
export function collapseStatuses(
  statuses: StatusLabel[],
  board: Board,
): Map<string, StatusLabel> {
  return collapseLatest(statuses, resolveModerators(board), board.coordinate, (s) => s.targetId);
}

/** Set of idea ids currently pinned: the latest authorized pin-namespace label per idea is "pinned". */
export function pinnedTargets(pins: PinLabel[], board: Board): Set<string> {
  const latest = collapseLatest(pins, resolveModerators(board), board.coordinate, (p) => p.targetId);
  const out = new Set<string>();
  for (const [targetId, label] of latest) if (label.pinned) out.add(targetId);
  return out;
}

/** Set of target ids (ideas or replies) whose latest authorized moderation label is "hidden". */
export function hiddenTargets(hides: HideLabel[], board: Board): Set<string> {
  const latest = collapseLatest(hides, resolveModerators(board), board.coordinate, (h) => h.targetId);
  const out = new Set<string>();
  for (const [targetId, label] of latest) if (label.hidden) out.add(targetId);
  return out;
}

/**
 * Set of pubkeys banned from a board. Owner precedence: the owner is never bannable (a mod cannot
 * depose the owner's voice on the owner's own board), and only the owner may ban a fellow moderator
 * (mods cannot ban each other). The latest authorized label per subject wins, and "unbanned" is the
 * off-state, so a ban is reversible.
 */
export function bannedSubjects(bans: BanLabel[], board: Board): Set<string> {
  // Apply the authority rule BEFORE the latest-wins collapse: drop labels that target the owner, and
  // labels by a non-owner that target a fellow moderator. Filtering first (not after collapse) means an
  // ineligible later label can never win the collapse and erase the owner's valid ban of a moderator.
  const eligible = bans.filter((b) => {
    if (b.subject === board.pubkey) return false; // the owner is unbannable
    const subjectIsModerator = board.moderators.some((m) => m.pubkey === b.subject);
    return !subjectIsModerator || b.pubkey === board.pubkey; // only the owner can ban a moderator
  });
  const latest = collapseLatest(eligible, resolveModerators(board), board.coordinate, (b) => b.subject);
  const out = new Set<string>();
  for (const [subject, label] of latest) if (label.banned) out.add(subject); // skip "unbanned" off-state
  return out;
}

/** Lock cutoff per idea (latest authorized lock), keyed by target id. */
export function lockCutoffs(locks: LockLabel[], board: Board): Map<string, number> {
  const collapsed = collapseLatest(locks, resolveModerators(board), board.coordinate, (l) => l.targetId);
  const out = new Map<string, number>();
  for (const [targetId, lock] of collapsed) out.set(targetId, lock.lockedAt);
  return out;
}
