/**
 * Approval = NIP-72 moderator post approval (kind 4550). Only used by curated boards: the client
 * renders a post once an authorized pubkey has approved it. The content carries the full stringified
 * original post for resilience. See docs/PROTOCOL.md.
 */

import { KIND } from "./kinds";
import { communityCoordinate, type CommunityRef } from "./coords";
import type { Board } from "./board";
import { resolveModerators } from "./moderation";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTagValue,
  now,
  validateNostrEvent,
} from "./event";

export interface BuildApprovalInput {
  board: CommunityRef;
  boardRelay?: string;
  /** the kind-1111 idea being approved */
  post: NostrEvent;
  postRelay?: string;
  createdAt?: number;
}

export function buildApproval(input: BuildApprovalInput): EventTemplate {
  const coord = communityCoordinate(input.board);
  const tags = compactTags([
    input.boardRelay ? ["a", coord, input.boardRelay] : ["a", coord],
    input.postRelay ? ["e", input.post.id, input.postRelay] : ["e", input.post.id],
    ["p", input.post.pubkey],
    ["k", String(input.post.kind)],
  ]);
  return {
    kind: KIND.PostApproval,
    created_at: input.createdAt ?? now(),
    tags,
    content: JSON.stringify(input.post),
  };
}

export interface Approval {
  pubkey: string; // approver (must be owner/mod to be honored)
  postId: string;
  postAuthor?: string;
  postKind?: number;
  coordinate?: string;
  /** the embedded original post, if the content held valid JSON */
  post?: NostrEvent;
  createdAt: number;
  raw: NostrEvent;
}

export function parseApproval(event: NostrEvent): Approval | null {
  if (event.kind !== KIND.PostApproval) return null;
  // Voxboard ideas are kind 1111 (regular events), so an approval always references the post by its
  // `e` id. NIP-72 also permits approving an ADDRESSABLE post by `a` coordinate only; we intentionally
  // do not honor `a`-only approvals because we never produce addressable posts. (See docs/PROTOCOL.md.)
  const postId = getTagValue(event.tags, "e");
  if (!postId) return null;

  const approval: Approval = {
    pubkey: event.pubkey,
    postId,
    createdAt: event.created_at,
    raw: event,
  };
  const author = getTagValue(event.tags, "p");
  const coordinate = getTagValue(event.tags, "a");
  const kindValue = getTagValue(event.tags, "k");
  if (author) approval.postAuthor = author;
  if (coordinate) approval.coordinate = coordinate;
  if (kindValue && Number.isFinite(Number(kindValue))) approval.postKind = Number(kindValue);

  if (event.content) {
    try {
      const embedded = validateNostrEvent(JSON.parse(event.content));
      if (embedded && embedded.id === postId) approval.post = embedded;
    } catch {
      // content was not valid JSON; ignore, the e/p/k tags are enough to honor the approval
    }
  }
  return approval;
}

/**
 * Set of post (idea) ids approved by an authorized owner/moderator (curated boards render only these).
 * The approval must be scoped to THIS board's coordinate (its `a` tag), exactly as labels are in
 * collapseLatest. Without this, an approval an owner/mod issued on a DIFFERENT board they run (or a
 * forged/over-returned 4550) would leak a post into this board's approved set; the relay `#a` filter
 * is only advisory.
 */
export function approvedPostIds(approvals: Approval[], board: Board): Set<string> {
  const authorized = resolveModerators(board);
  const out = new Set<string>();
  for (const approval of approvals) {
    if (!authorized.has(approval.pubkey)) continue;
    if (approval.coordinate !== board.coordinate) continue; // not scoped to this board
    out.add(approval.postId);
  }
  return out;
}
