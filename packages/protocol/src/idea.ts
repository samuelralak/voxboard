/**
 * Idea = a top-level board post (NIP-22 kind 1111) whose root AND parent scopes both point at the
 * community. Distinguished from a reply (also kind 1111) by the lowercase parent naming the community
 * (k = 34550) rather than an event. See docs/PROTOCOL.md.
 */

import { KIND } from "./kinds";
import { parseCommunityCoordinate, communityCoordinate, type CommunityRef } from "./coords";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTags,
  getTagValue,
  getTagValues,
  now,
} from "./event";
import {
  communityRootTags,
  communityParentTags,
  imetaTag,
  parseImeta,
  type ImageAttachment,
} from "./scope";
import { sanitizeLine, sanitizeText } from "./sanitize";

export interface BuildIdeaInput {
  board: CommunityRef;
  boardRelay?: string;
  title: string;
  body?: string;
  categories?: string[];
  images?: ImageAttachment[];
  createdAt?: number;
}

export function buildIdea(input: BuildIdeaInput): EventTemplate {
  const tags: (string[] | undefined)[] = [
    ...communityRootTags(input.board, input.boardRelay),
    ...communityParentTags(input.board, input.boardRelay),
    // Only emit a subject tag when there is a title; otherwise readers fall back to the first line.
    input.title.trim().length > 0 ? ["subject", input.title] : undefined,
  ];
  for (const category of input.categories ?? []) tags.push(["t", category]);
  for (const image of input.images ?? []) tags.push(imetaTag(image));

  return {
    kind: KIND.Comment,
    created_at: input.createdAt ?? now(),
    tags: compactTags(tags),
    content: input.body ?? "",
  };
}

export interface Idea {
  id: string;
  pubkey: string;
  board: CommunityRef;
  coordinate: string;
  title: string;
  body: string;
  categories: string[];
  images: ImageAttachment[];
  createdAt: number;
  raw: NostrEvent;
}

/**
 * True if this kind-1111 event is a top-level idea (its PARENT is the community), not a reply.
 *
 * The discriminator is the parent SCOPE (lowercase a = root A, parent kind = 34550), NOT the absence
 * of an `e` tag. Real NIP-22 clients (Amethyst, etc.) add an `e`/`E` reference to the community
 * DEFINITION event on a top-level post; that does not make it a reply. Keying off the e-tag presence
 * misclassified every such idea as a reply (boards showed zero ideas). See PROTOCOL.md.
 */
export function isIdeaEvent(event: NostrEvent): boolean {
  if (event.kind !== KIND.Comment) return false;
  const A = getTagValue(event.tags, "A");
  const lowerA = getTagValue(event.tags, "a");
  const lowerK = getTagValue(event.tags, "k");
  return A !== undefined && lowerK === String(KIND.Community) && lowerA === A;
}

export function parseIdea(event: NostrEvent): Idea | null {
  if (!isIdeaEvent(event)) return null;
  const coordinate = getTagValue(event.tags, "A");
  if (!coordinate) return null;
  const board = parseCommunityCoordinate(coordinate);
  if (!board) return null;

  // Defuse bidi-override / zero-width / control characters so a relay can't scramble or fake the title.
  const subject = sanitizeLine(getTagValue(event.tags, "subject") ?? "");
  const title = subject.length > 0 ? subject : sanitizeLine(firstLine(event.content));

  const images: ImageAttachment[] = [];
  for (const t of getTags(event.tags, "imeta")) {
    const img = parseImeta(t);
    if (img) images.push(img);
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    board,
    coordinate: communityCoordinate(board),
    title,
    body: sanitizeText(event.content),
    // trim + sanitize each category so the feed filter matches parseBoard's normalized categories.
    categories: [...new Set(getTagValues(event.tags, "t").map((c) => sanitizeLine(c)).filter((c) => c.length > 0))],
    images,
    createdAt: event.created_at,
    raw: event,
  };
}

function firstLine(content: string): string {
  const line = content.split("\n", 1)[0];
  return (line ?? "").trim();
}
