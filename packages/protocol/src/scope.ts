/**
 * NIP-22 / NIP-72 tag scoping and NIP-92 media tags.
 *
 * Threading model (see docs/PROTOCOL.md): every board post and reply is a kind-1111 comment whose
 * UPPERCASE tags (A/K/P) pin the ROOT scope to the community, and whose LOWERCASE tags (a/k/p or
 * e/k/p) name the immediate PARENT. A top-level idea's parent is the community itself; a reply's
 * parent is the idea or another reply.
 */

import { KIND } from "./kinds";
import type { CommunityRef } from "./coords";
import { communityCoordinate } from "./coords";
import { isHttpUrl } from "./sanitize";

/** Root scope (uppercase) pinned to the community: A / K / P. */
export function communityRootTags(board: CommunityRef, relay?: string): string[][] {
  const coord = communityCoordinate(board);
  return [
    relay ? ["A", coord, relay] : ["A", coord],
    ["K", String(KIND.Community)],
    relay ? ["P", board.pubkey, relay] : ["P", board.pubkey],
  ];
}

/** Parent scope (lowercase) pointing at the community itself: a / k / p. Used for top-level ideas. */
export function communityParentTags(board: CommunityRef, relay?: string): string[][] {
  const coord = communityCoordinate(board);
  return [
    relay ? ["a", coord, relay] : ["a", coord],
    ["k", String(KIND.Community)],
    relay ? ["p", board.pubkey, relay] : ["p", board.pubkey],
  ];
}

export interface ParentRef {
  id: string;
  pubkey: string;
  kind: number;
  relay?: string;
}

/** Parent scope (lowercase) pointing at a parent EVENT (idea or reply): e / k / p. Used for replies. */
export function eventParentTags(parent: ParentRef): string[][] {
  return [
    ["e", parent.id, parent.relay ?? "", parent.pubkey],
    ["k", String(parent.kind)],
    parent.relay ? ["p", parent.pubkey, parent.relay] : ["p", parent.pubkey],
  ];
}

// ---------------------------------------------------------------------------
// NIP-92 media attachments (imeta)
// ---------------------------------------------------------------------------

export interface ImageAttachment {
  url: string;
  mime?: string;
  alt?: string;
  dim?: string;
  blurhash?: string;
}

/** Build a NIP-92 `imeta` tag from an image attachment. */
export function imetaTag(img: ImageAttachment): string[] {
  const parts: string[] = [`url ${img.url}`];
  if (img.mime) parts.push(`m ${img.mime}`);
  if (img.alt) parts.push(`alt ${img.alt}`);
  if (img.dim) parts.push(`dim ${img.dim}`);
  if (img.blurhash) parts.push(`blurhash ${img.blurhash}`);
  return ["imeta", ...parts];
}

/**
 * Parse a NIP-92 `imeta` tag back into an image attachment. Returns null if it carries no url, or if
 * the url is not http(s) (drops javascript:/data:/relative urls so consumers never render an unsafe
 * <img src> beacon).
 */
export function parseImeta(tag: string[]): ImageAttachment | null {
  const map: Record<string, string> = {};
  for (const part of tag.slice(1)) {
    const sp = part.indexOf(" ");
    if (sp < 0) continue;
    map[part.slice(0, sp)] = part.slice(sp + 1);
  }
  const url = map["url"];
  if (!url || !isHttpUrl(url)) return null;
  const img: ImageAttachment = { url };
  if (map["m"]) img.mime = map["m"];
  if (map["alt"]) img.alt = map["alt"];
  if (map["dim"]) img.dim = map["dim"];
  if (map["blurhash"]) img.blurhash = map["blurhash"];
  return img;
}
