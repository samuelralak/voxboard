/**
 * Reply = a threaded comment on an idea or another reply (NIP-22 kind 1111). Root scope stays the
 * community (uppercase A/K/P); the lowercase e/k/p name the immediate parent event. The reply tree
 * is built client-side from the lowercase `e` parent pointers. See docs/PROTOCOL.md.
 */

import { KIND } from "./kinds";
import { parseCommunityCoordinate, communityCoordinate, type CommunityRef } from "./coords";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTag,
  getTagValue,
  now,
} from "./event";
import { communityRootTags, eventParentTags, type ParentRef } from "./scope";
import { sanitizeText } from "./sanitize";

// Read-path body cap so a hostile relay event can't carry a megabyte reply. Over-cap parses return
// null (rejected like any other invalid field), they do NOT throw. Generous enough for real replies.
export const MAX_REPLY_BODY = 20_000;

export interface BuildReplyInput {
  board: CommunityRef;
  boardRelay?: string;
  /** the idea or parent reply being replied to */
  parent: ParentRef;
  body: string;
  createdAt?: number;
}

export function buildReply(input: BuildReplyInput): EventTemplate {
  const tags = compactTags([
    ...communityRootTags(input.board, input.boardRelay),
    ...eventParentTags(input.parent),
  ]);
  return {
    kind: KIND.Comment,
    created_at: input.createdAt ?? now(),
    tags,
    content: input.body,
  };
}

export interface Reply {
  id: string;
  pubkey: string;
  board: CommunityRef;
  coordinate: string;
  /** the immediate parent event id (an idea or another reply) */
  parentId: string;
  parentKind: number;
  parentAuthor?: string;
  body: string;
  createdAt: number;
  raw: NostrEvent;
}

/**
 * True if this kind-1111 event is a reply (its PARENT is another comment, not the community).
 *
 * A reply has a lowercase `e` parent pointer. But a top-level idea may ALSO carry an `e`/`E` reference
 * to the community DEFINITION event (Amethyst, etc.), so the e-tag alone is not enough: an event whose
 * parent IS the community (lowercase a = root A, parent kind = 34550) is an idea, not a reply.
 */
export function isReplyEvent(event: NostrEvent): boolean {
  if (event.kind !== KIND.Comment) return false;
  const A = getTagValue(event.tags, "A");
  if (A === undefined) return false;
  const eTag = getTag(event.tags, "e");
  if (eTag === undefined || !eTag[1]) return false;
  const lowerA = getTagValue(event.tags, "a");
  const lowerK = getTagValue(event.tags, "k");
  if (lowerA === A && lowerK === String(KIND.Community)) return false; // parent is the community: an idea
  return true;
}

export function parseReply(event: NostrEvent): Reply | null {
  if (!isReplyEvent(event)) return null;
  const coordinate = getTagValue(event.tags, "A");
  if (!coordinate) return null;
  const board = parseCommunityCoordinate(coordinate);
  if (!board) return null;

  const eTag = getTag(event.tags, "e");
  const parentId = eTag?.[1];
  if (!parentId) return null;

  // body is a DISPLAY field: bound length (post-sanitize) but TRUNCATE, never reject the whole reply
  // (which would orphan it from the thread). null is reserved for structurally invalid events above.
  const body = sanitizeText(event.content).slice(0, MAX_REPLY_BODY);

  const kindValue = getTagValue(event.tags, "k");
  const parentKind = kindValue ? Number(kindValue) : KIND.Comment;
  const parentAuthor =
    (eTag[3] && eTag[3].length > 0 ? eTag[3] : undefined) ?? getTagValue(event.tags, "p");

  const reply: Reply = {
    id: event.id,
    pubkey: event.pubkey,
    board,
    coordinate: communityCoordinate(board),
    parentId,
    parentKind: Number.isFinite(parentKind) ? parentKind : KIND.Comment,
    body,
    createdAt: event.created_at,
    raw: event,
  };
  if (parentAuthor) reply.parentAuthor = parentAuthor;
  return reply;
}
