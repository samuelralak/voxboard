/**
 * Addressable coordinates and NIP-19 entity helpers.
 *
 * A board is a NIP-72 community (kind 34550); its stable id is the coordinate
 * `34550:<owner-pubkey>:<board-slug>`, shareable as an `naddr`. Ideas/replies are shared as `nevent`.
 * See docs/PROTOCOL.md.
 */

import * as nip19 from "nostr-tools/nip19";
import { KIND } from "./kinds";

export interface CommunityRef {
  /** board owner pubkey (hex) */
  pubkey: string;
  /** board slug (the community `d` identifier) */
  slug: string;
}

/** Build the addressable coordinate string `34550:<pubkey>:<slug>` for a board. */
export function communityCoordinate({ pubkey, slug }: CommunityRef): string {
  return `${KIND.Community}:${pubkey}:${slug}`;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
/** A canonical non-negative decimal kind (no leading zeros, whitespace, sign, dot, or exponent). */
const CANONICAL_KIND = /^(0|[1-9][0-9]*)$/;

/** Cap relay hints carried in a shared entity, and only allow ws(s) schemes (no javascript:/http: injection). */
const MAX_RELAY_HINTS = 10;
function sanitizeRelays(relays: readonly string[] | undefined): string[] {
  if (!relays) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const relay of relays) {
    if (typeof relay !== "string" || !/^wss?:\/\//i.test(relay) || seen.has(relay)) continue;
    seen.add(relay);
    out.push(relay);
    if (out.length >= MAX_RELAY_HINTS) break;
  }
  return out;
}

/**
 * Parse a `kind:pubkey:identifier` coordinate. Returns null if malformed. Strict so non-canonical
 * spellings ('  34550', '3.4550e4', '34550.0', an empty kind, a non-hex pubkey) cannot alias to a real
 * coordinate (which would split caches / spoof boards). The pubkey is lowercased for a stable identity.
 */
export function parseCoordinate(
  coord: string,
): { kind: number; pubkey: string; identifier: string } | null {
  const firstColon = coord.indexOf(":");
  const secondColon = coord.indexOf(":", firstColon + 1);
  if (firstColon < 0 || secondColon < 0) return null;
  const kindStr = coord.slice(0, firstColon);
  const pubkey = coord.slice(firstColon + 1, secondColon);
  const identifier = coord.slice(secondColon + 1);
  if (!CANONICAL_KIND.test(kindStr) || !HEX64.test(pubkey)) return null;
  return { kind: Number(kindStr), pubkey: pubkey.toLowerCase(), identifier };
}

/** Parse a coordinate that must be a board (kind 34550) into a CommunityRef. */
export function parseCommunityCoordinate(coord: string): CommunityRef | null {
  const parsed = parseCoordinate(coord);
  if (!parsed || parsed.kind !== KIND.Community) return null;
  return { pubkey: parsed.pubkey, slug: parsed.identifier };
}

/** Encode a board as an `naddr` (carries the 34550 coordinate + optional relay hints). */
export function boardNaddr(ref: CommunityRef, relays: string[] = []): string {
  return nip19.naddrEncode({
    identifier: ref.slug,
    pubkey: ref.pubkey,
    kind: KIND.Community,
    relays: sanitizeRelays(relays),
  });
}

export interface IdeaRef {
  /** the kind-1111 event id (hex) */
  id: string;
  /** author pubkey hint (hex) */
  author?: string;
  relays?: string[];
}

/** Encode an idea/reply (kind 1111 event) as an `nevent`. */
export function ideaNevent({ id, author, relays = [] }: IdeaRef): string {
  return nip19.neventEncode({ id, author, relays, kind: KIND.Comment });
}

export type DecodedEntity =
  | { type: "board"; ref: CommunityRef; relays: string[] }
  | { type: "idea"; ref: IdeaRef }
  | { type: "npub"; pubkey: string }
  | { type: "other"; raw: nip19.DecodedResult };

/** Decode any NIP-19 entity we care about (naddr board, nevent/note idea, npub). */
export function decodeEntity(bech32: string): DecodedEntity | null {
  let decoded: nip19.DecodedResult;
  try {
    decoded = nip19.decode(bech32);
  } catch {
    return null;
  }

  switch (decoded.type) {
    case "naddr": {
      const d = decoded.data;
      if (d.kind !== KIND.Community) return { type: "other", raw: decoded };
      return {
        type: "board",
        ref: { pubkey: d.pubkey, slug: d.identifier },
        relays: sanitizeRelays(d.relays),
      };
    }
    case "nevent": {
      const ref: IdeaRef = { id: decoded.data.id, relays: sanitizeRelays(decoded.data.relays) };
      if (decoded.data.author) ref.author = decoded.data.author;
      return { type: "idea", ref };
    }
    case "note":
      return { type: "idea", ref: { id: decoded.data } };
    case "npub":
      return { type: "npub", pubkey: decoded.data };
    case "nprofile":
      // an nprofile resolves to a pubkey (plus relay hints we don't need here); treat it as one.
      return { type: "npub", pubkey: decoded.data.pubkey };
    default:
      return { type: "other", raw: decoded };
  }
}
