/**
 * Board = NIP-72 community definition (kind 34550, addressable). The owner is the event author;
 * moderators are the `p` tags. See docs/PROTOCOL.md.
 */

import { KIND, MODERATION_MODE, type ModerationMode } from "./kinds";
import { communityCoordinate, type CommunityRef } from "./coords";
import { isHttpUrl, sanitizeLine, sanitizeText } from "./sanitize";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTag,
  getTagValue,
  getTags,
  getTagValues,
  now,
} from "./event";

// Read-path length caps so a hostile relay event can't carry a megabyte name/description/category.
// Over-cap values are rejected the same way an empty name is (parse returns null / the value is
// dropped), they do NOT throw. Generous enough for real boards.
export const MAX_BOARD_NAME = 200;
export const MAX_BOARD_DESCRIPTION = 2_000;
export const MAX_CATEGORY_NAME = 80;

export interface BoardModerator {
  pubkey: string;
  relay?: string;
}

export interface BoardRelay {
  url: string;
  marker?: "author" | "requests" | "approvals";
}

export interface BoardImage {
  url: string;
  /** "<width>x<height>", optional */
  dim?: string;
}

export interface BuildBoardInput {
  slug: string;
  name: string;
  description?: string;
  image?: BoardImage;
  moderators?: BoardModerator[];
  relays?: BoardRelay[];
  categories?: string[];
  mode?: ModerationMode;
  createdAt?: number;
}

export function buildBoard(input: BuildBoardInput): EventTemplate {
  const tags: (string[] | undefined)[] = [
    ["d", input.slug],
    ["name", input.name],
    input.description ? ["description", input.description] : undefined,
    input.image
      ? input.image.dim
        ? ["image", input.image.url, input.image.dim]
        : ["image", input.image.url]
      : undefined,
  ];

  for (const mod of input.moderators ?? []) {
    // NIP-72 community moderators carry the literal "moderator" marker. A separate admin/moderator
    // distinction, if ever needed, lives in a NIP-51 set (see docs/PROTOCOL.md), not on this marker.
    tags.push(["p", mod.pubkey, mod.relay ?? "", "moderator"]);
  }
  for (const relay of input.relays ?? []) {
    tags.push(relay.marker ? ["relay", relay.url, relay.marker] : ["relay", relay.url]);
  }
  for (const category of input.categories ?? []) {
    tags.push(["t", category]);
  }
  tags.push(["moderation_mode", input.mode ?? MODERATION_MODE.open]);

  return {
    kind: KIND.Community,
    created_at: input.createdAt ?? now(),
    tags: compactTags(tags),
    content: "",
  };
}

export interface Board {
  /** owner pubkey (event author) */
  pubkey: string;
  /** the community `d` identifier */
  slug: string;
  /** addressable coordinate `34550:<pubkey>:<slug>` */
  coordinate: string;
  ref: CommunityRef;
  name: string;
  description?: string;
  image?: BoardImage;
  moderators: BoardModerator[];
  relays: BoardRelay[];
  categories: string[];
  mode: ModerationMode;
  createdAt: number;
  raw: NostrEvent;
}

export function parseBoard(event: NostrEvent): Board | null {
  if (event.kind !== KIND.Community) return null;
  const slug = getTagValue(event.tags, "d");
  // d may be empty (the addressable default), but a board with no `d` tag at all is unaddressable.
  if (slug === undefined) return null;
  // Sanitize (defuse bidi/zero-width junk), then TRUNCATE an over-long name to MAX_BOARD_NAME rather than
  // reject the whole board (rejecting would drop the board and every idea under it); name is a DISPLAY
  // field. A name that sanitizes to "" (pure junk, or absent) is still fatal: a board needs a label.
  const name = sanitizeLine(getTagValue(event.tags, "name") ?? "").slice(0, MAX_BOARD_NAME);
  if (!name) return null;

  const ref: CommunityRef = { pubkey: event.pubkey, slug };

  const moderators: BoardModerator[] = [];
  const seenMods = new Set<string>();
  for (const t of getTags(event.tags, "p")) {
    // Only p-tags carrying the canonical NIP-72 "moderator" marker grant moderation authority.
    // Unmarked or otherwise-marked p-tags are not moderators (avoids over-granting trust).
    if (t[3] !== "moderator") continue;
    const pubkey = t[1]?.toLowerCase();
    // a moderator id must be a real 64-hex pubkey, and each appears once (a garbage or duplicated id
    // can never match a real author and would just pollute the authorization set).
    if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey) || seenMods.has(pubkey)) continue;
    seenMods.add(pubkey);
    const relay = t[2] && t[2].length > 0 ? t[2] : undefined;
    const mod: BoardModerator = { pubkey };
    if (relay) mod.relay = relay;
    moderators.push(mod);
  }

  const relays: BoardRelay[] = [];
  for (const t of getTags(event.tags, "relay")) {
    const url = t[1];
    if (!url) continue;
    const marker = t[2];
    const relay: BoardRelay = { url };
    if (marker === "author" || marker === "requests" || marker === "approvals") {
      relay.marker = marker;
    }
    relays.push(relay);
  }

  const imageTag = getTag(event.tags, "image");
  let image: BoardImage | undefined;
  // Only honor an http(s) image URL; a javascript:/data:/file: scheme never reaches an <img src>.
  if (imageTag?.[1] && isHttpUrl(imageTag[1])) {
    image = { url: imageTag[1] };
    if (imageTag[2]) image.dim = imageTag[2];
  }

  const modeValue = getTagValue(event.tags, "moderation_mode");
  const mode: ModerationMode =
    modeValue === MODERATION_MODE.curated ? MODERATION_MODE.curated : MODERATION_MODE.open;

  const descriptionRaw = getTagValue(event.tags, "description");
  const sanitizedDescription = descriptionRaw ? sanitizeText(descriptionRaw) : undefined;
  // Drop an over-long description (the field is optional) rather than store megabytes of relay junk.
  const description =
    sanitizedDescription && sanitizedDescription.length <= MAX_BOARD_DESCRIPTION
      ? sanitizedDescription
      : undefined;

  const board: Board = {
    pubkey: event.pubkey,
    slug,
    coordinate: communityCoordinate(ref),
    ref,
    name,
    moderators,
    relays,
    // sanitizeLine (not just trim) so board categories normalize identically to parseIdea's, keeping
    // the feed's category filter a reliable match. An over-long category (relay junk) is dropped too.
    categories: [...new Set(getTagValues(event.tags, "t").map((c) => sanitizeLine(c)).filter((c) => c.length > 0 && c.length <= MAX_CATEGORY_NAME))],
    mode,
    createdAt: event.created_at,
    raw: event,
  };
  if (description) board.description = description;
  if (image) board.image = image;
  return board;
}
