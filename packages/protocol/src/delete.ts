/**
 * Deletion = NIP-09 kind 5. A user can only delete their OWN events (relays MUST validate that each
 * referenced event's pubkey equals the deletion author's). Used to retract an idea, reply, or vote,
 * and to unpin/unlock (delete the label). Honoring is advisory, so the indexer also hides locally.
 * See docs/PROTOCOL.md.
 */

import { KIND } from "./kinds";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTagValue,
  getTagValues,
  now,
} from "./event";

export interface BuildDeleteInput {
  /** event ids to delete */
  ids?: string[];
  /** addressable coordinates (`kind:pubkey:d`) to delete */
  coords?: string[];
  /** kinds of the deleted events (recommended) */
  kinds?: number[];
  /** the board coordinate (34550:pubkey:d) this retraction belongs to. Emitted as an `A` tag so it is
   *  reachable by a stable `#A` subscription (alongside the `e`/`a` targets). Purely additive. */
  scope?: string;
  reason?: string;
  createdAt?: number;
}

export function buildDelete(input: BuildDeleteInput): EventTemplate {
  const tags: (string[] | undefined)[] = [];
  for (const id of input.ids ?? []) tags.push(["e", id]);
  for (const coord of input.coords ?? []) tags.push(["a", coord]);
  for (const kind of input.kinds ?? []) tags.push(["k", String(kind)]);
  // Board coordinate (uppercase root scope) so the retraction is reachable by a stable `#A` sub.
  // parseDelete ignores it (the deletion still applies by its `e`/`a` targets), so it is additive.
  if (input.scope) tags.push(["A", input.scope]);
  return {
    kind: KIND.Delete,
    created_at: input.createdAt ?? now(),
    tags: compactTags(tags),
    content: input.reason ?? "",
  };
}

export interface Deletion {
  pubkey: string;
  ids: string[];
  coords: string[];
  /** kinds of the deleted events (NIP-09 `k` hints) */
  kinds: number[];
  reason: string;
  createdAt: number;
  raw: NostrEvent;
}

export function parseDelete(event: NostrEvent): Deletion | null {
  if (event.kind !== KIND.Delete) return null;
  const ids = getTagValues(event.tags, "e");
  const coords = getTagValues(event.tags, "a");
  if (ids.length === 0 && coords.length === 0) return null;
  const kinds = getTagValues(event.tags, "k")
    .map(Number)
    .filter((k) => Number.isInteger(k));
  return {
    pubkey: event.pubkey,
    ids,
    coords,
    kinds,
    reason: event.content,
    createdAt: event.created_at,
    raw: event,
  };
}

/**
 * Apply a set of deletion events to candidate events, returning the ids that should be hidden.
 * Enforces the NIP-09 rules: a deletion only affects events authored by the SAME pubkey; an `e`
 * (event-id) deletion hides that exact event; an `a` (addressable/replaceable coordinate) deletion
 * hides matching events whose `created_at` is at or before the deletion's `created_at` (so a newer
 * replacement survives an older delete).
 */
/** Kinds whose identity is a `kind:pubkey:d` coordinate (NIP-01): replaceable + addressable + 0/3. */
function isAddressableOrReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000);
}

export function deletedEventIds(deletions: Deletion[], candidates: NostrEvent[]): Set<string> {
  const idsByAuthor = new Map<string, Set<string>>();
  const coordsByAuthor = new Map<string, Map<string, number>>();

  for (const d of deletions) {
    if (d.ids.length > 0) {
      let set = idsByAuthor.get(d.pubkey);
      if (!set) {
        set = new Set<string>();
        idsByAuthor.set(d.pubkey, set);
      }
      for (const id of d.ids) set.add(id);
    }
    if (d.coords.length > 0) {
      let map = coordsByAuthor.get(d.pubkey);
      if (!map) {
        map = new Map<string, number>();
        coordsByAuthor.set(d.pubkey, map);
      }
      for (const coord of d.coords) {
        const prev = map.get(coord);
        if (prev === undefined || d.createdAt > prev) map.set(coord, d.createdAt);
      }
    }
  }

  const hidden = new Set<string>();
  for (const event of candidates) {
    if (idsByAuthor.get(event.pubkey)?.has(event.id)) {
      hidden.add(event.id);
      continue;
    }
    // An `a` (coordinate) deletion only identifies addressable/replaceable events. Applying it to a
    // regular event (e.g. a kind-1111 idea/reply, which has no real `d` coordinate) would let one
    // delete tombstone every d-less event the author has of that kind. Those are deleted only by `e`.
    const coordMap = coordsByAuthor.get(event.pubkey);
    if (coordMap && coordMap.size > 0 && isAddressableOrReplaceable(event.kind)) {
      const dValue = getTagValue(event.tags, "d") ?? "";
      const coord = `${event.kind}:${event.pubkey}:${dValue}`;
      const deletedAt = coordMap.get(coord);
      if (deletedAt !== undefined && event.created_at <= deletedAt) hidden.add(event.id);
    }
  }
  return hidden;
}
