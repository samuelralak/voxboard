/**
 * Platform attestation: the strict-allowlist gate that decides which boards appear in production
 * discover. It is encoded as TWO carriers signed by ONE platform issuer key (never a user key):
 *
 *   1. A single addressable NIP-51 set (kind 30000, d="attested") authored by the issuer, listing every
 *      attested board coordinate as an `a` tag. Addressable latest-wins, so a board is revoked simply by
 *      republishing the set WITHOUT its coordinate. This is the discover gate: fetchDiscoverBoards filters
 *      to the coordinates in this set after re-verifying the issuer's signature. (carrier 1)
 *
 *   2. A per-board NIP-32 label (kind 1985) pinning BOTH the board coordinate (`a`) and the EXACT board
 *      event id (`e`). The `e` pin auto-revokes the moment a board is edited (new event id), so a board
 *      cannot be attested clean and then have spam swapped in under the same coordinate. It drives the
 *      per-board "Attested" badge. (carrier 2)
 *
 * Anti-forgery is the BIP-340 signature over (1) and (2): without the issuer key no valid set/label can be
 * produced, and existing signatures can't be mauled. Trust in the issuer key ITSELF comes from NIP-05 (the
 * key is published at voxboard.space/.well-known/nostr.json), NOT hardcoded in the bundle, so it rotates.
 *
 * Anti-sybil is policy, not crypto: a free pubkey only proves "the platform vouched", so the admission
 * gate (a conforming board + an authenticated owner request) lives in the signer, never here.
 *
 * Like the rest of @voxboard/protocol these are PURE builders/parsers: they DO NOT verify the Schnorr
 * signature. The caller MUST `verifyEvent` (nostr-tools) and pin `event.pubkey === issuerPubkey` before
 * trusting a set/label — the same boundary discipline as validateNostrEvent (see event.ts). The parsers
 * here check structure + the env-scoped namespace; verifyAttestationSet additionally pins the issuer.
 */

import { ATTESTATION, KIND } from "./kinds";
import { communityCoordinate, parseCommunityCoordinate } from "./coords";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTagValue,
  getTagValues,
  now,
} from "./event";

// ---------------------------------------------------------------------------
// Carrier 2 — per-board label (kind 1985), the badge + anti-swap pin
// ---------------------------------------------------------------------------

export interface AttestationLabelInput {
  /** the board coordinate `34550:<owner>:<slug>` (the `a` pin) */
  coordinate: string;
  /** the EXACT current board event id (the `e` pin) — attestation auto-revokes when the board is edited */
  eventId: string;
  /** env-scoped namespace from attestationNamespace(); pinned on read so staging can't validate in prod */
  namespace: string;
  createdAt?: number;
}

/** A per-board attestation label (kind 1985): issuer vouches for THIS board version (coordinate + event id). */
export function buildAttestationLabel(input: AttestationLabelInput): EventTemplate {
  return attestationLabel(input, ATTESTATION.attested);
}

/**
 * Per-board revocation via a superseding label valued "delisted" (the off-state), mirroring pin/unpin and
 * hide/unhide so read collapses to latest-from-issuer-wins. The set (carrier 1) is the authoritative
 * discover gate; this keeps the per-board badge consistent. NIP-09-deleting the original label also works
 * (NIP-32's own recommended revoke); the signer does both in one revoke op.
 */
export function buildDelistLabel(input: AttestationLabelInput): EventTemplate {
  return attestationLabel(input, ATTESTATION.delisted);
}

function attestationLabel(input: AttestationLabelInput, value: string): EventTemplate {
  return {
    kind: KIND.Label,
    created_at: input.createdAt ?? now(),
    tags: compactTags([
      ["L", input.namespace],
      ["l", value, input.namespace],
      ["a", input.coordinate],
      ["e", input.eventId],
    ]),
    content: "",
  };
}

// ---------------------------------------------------------------------------
// Carrier 1 — the addressable allowlist set (kind 30000, d="attested")
// ---------------------------------------------------------------------------

export interface AttestationSetInput {
  /** the FULL current list of attested board coordinates (latest-wins; omit a coordinate to revoke it) */
  coordinates: readonly string[];
  /** env-scoped namespace from attestationNamespace() */
  namespace: string;
  createdAt?: number;
}

/**
 * The whole allowlist as one addressable set. Republish in full on every change — addressable latest-wins
 * means the newest version is the entire truth, so an omitted coordinate is an instant, deletion-free
 * revocation. Duplicate coordinates are dropped (first occurrence wins) so the set stays canonical.
 */
export function buildAttestationSet(input: AttestationSetInput): EventTemplate {
  const seen = new Set<string>();
  const coordTags: (string[] | undefined)[] = [];
  for (const coord of input.coordinates) {
    if (seen.has(coord)) continue;
    seen.add(coord);
    coordTags.push(["a", coord]);
  }
  return {
    kind: ATTESTATION.setKind,
    created_at: input.createdAt ?? now(),
    tags: compactTags([
      ["d", ATTESTATION.setIdentifier],
      ["L", input.namespace],
      ["l", ATTESTATION.attested, input.namespace],
      ...coordTags,
    ]),
    content: "",
  };
}

// ---------------------------------------------------------------------------
// Parsers (structure + env-scoped namespace only; caller verifies the signature)
// ---------------------------------------------------------------------------

export interface AttestationLabel {
  /** the authoring key — caller MUST pin this === the issuer pubkey resolved from NIP-05 */
  pubkey: string;
  /** the attested board coordinate */
  coordinate: string;
  /** the pinned board event id (anti-swap: must equal the board's current event id to count) */
  eventId: string;
  /** true for "attested", false for the "delisted" off-state */
  attested: boolean;
  createdAt: number;
  raw: NostrEvent;
}

export interface AttestationSet {
  /** the authoring key — caller MUST pin this === the issuer pubkey */
  pubkey: string;
  /** the attested board coordinates (de-duped, board coordinates only) */
  coordinates: string[];
  createdAt: number;
  raw: NostrEvent;
}

function declaresNamespace(event: NostrEvent, namespace: string): boolean {
  return event.tags.some((t) => t[0] === "L" && t[1] === namespace);
}

function labelValue(event: NostrEvent, namespace: string): string | undefined {
  // pin the FULL `["l", value, namespace]` (third element), so a staging-namespace label can't be read as
  // a prod one — the exact env-leak Switchboard's full-tag match prevents.
  return event.tags.find((t) => t[0] === "l" && t[2] === namespace)?.[1];
}

/** Parse a per-board attestation label that declares the given env-scoped namespace, or null. */
export function parseAttestationLabel(event: NostrEvent, namespace: string): AttestationLabel | null {
  if (event.kind !== KIND.Label) return null;
  if (!declaresNamespace(event, namespace)) return null;
  const value = labelValue(event, namespace);
  if (value !== ATTESTATION.attested && value !== ATTESTATION.delisted) return null;
  const rawCoordinate = getTagValue(event.tags, "a");
  const eventId = getTagValue(event.tags, "e");
  if (!rawCoordinate || !eventId) return null;
  const ref = parseCommunityCoordinate(rawCoordinate);
  if (!ref) return null; // must pin a board (kind-34550) coordinate
  // canonicalize (lowercase the pubkey segment) so a case-variant coordinate keys identically everywhere
  const coordinate = communityCoordinate(ref);
  return {
    pubkey: event.pubkey,
    coordinate,
    eventId,
    attested: value === ATTESTATION.attested,
    createdAt: event.created_at,
    raw: event,
  };
}

/** Parse the addressable allowlist set that declares the given env-scoped namespace, or null. */
export function parseAttestationSet(event: NostrEvent, namespace: string): AttestationSet | null {
  if (event.kind !== ATTESTATION.setKind) return null;
  if (getTagValue(event.tags, "d") !== ATTESTATION.setIdentifier) return null;
  if (!declaresNamespace(event, namespace)) return null;
  // keep only well-formed board coordinates (drop malformed/foreign `a` tags), canonicalized (lowercase
  // pubkey) and de-duped so case-variants of the same board can't double-count or split membership.
  const coordinates = [
    ...new Set(
      getTagValues(event.tags, "a")
        .map((c) => {
          const ref = parseCommunityCoordinate(c);
          return ref ? communityCoordinate(ref) : null;
        })
        .filter((c): c is string => c !== null),
    ),
  ];
  return { pubkey: event.pubkey, coordinates, createdAt: event.created_at, raw: event };
}

// ---------------------------------------------------------------------------
// Verification helpers (issuer pin + read-time collapse)
// ---------------------------------------------------------------------------

/**
 * Parse the allowlist set ONLY if it is authored by the pinned issuer pubkey and declares the env-scoped
 * namespace. The caller MUST have already run verifyEvent(event) (Schnorr) — this does not verify the
 * signature, only the author and structure. Returns the set, or null if not from the issuer / wrong ns.
 */
export function verifyAttestationSet(
  event: NostrEvent,
  issuerPubkey: string,
  namespace: string,
): AttestationSet | null {
  if (event.pubkey.toLowerCase() !== issuerPubkey.toLowerCase()) return null;
  return parseAttestationSet(event, namespace);
}

/** O(1)-membership Set of the attested coordinates in a parsed/verified set. */
export function attestedCoordinates(set: AttestationSet): Set<string> {
  return new Set(set.coordinates);
}

/**
 * Current attested-state per board coordinate from the issuer's per-board labels: latest label per
 * coordinate wins (a later "delisted" supersedes an earlier "attested"), tiebreak lowest event id (NIP-01).
 * Only labels authored by the pinned issuer count; the caller verifies signatures first.
 */
export function collapseAttestationLabels(
  labels: readonly NostrEvent[],
  issuerPubkey: string,
  namespace: string,
): Map<string, AttestationLabel> {
  const issuer = issuerPubkey.toLowerCase();
  const latest = new Map<string, AttestationLabel>();
  for (const event of labels) {
    if (event.pubkey.toLowerCase() !== issuer) continue;
    const label = parseAttestationLabel(event, namespace);
    if (!label) continue;
    const prev = latest.get(label.coordinate);
    if (
      !prev ||
      label.createdAt > prev.createdAt ||
      (label.createdAt === prev.createdAt && label.raw.id < prev.raw.id)
    ) {
      latest.set(label.coordinate, label);
    }
  }
  return latest;
}

/**
 * Whether a board's CURRENT version is attested for the per-board badge: the latest issuer label for its
 * coordinate must be "attested" AND its pinned `e` event id must equal the board's current event id. The
 * event-id match is the anti-swap guarantee — editing a board (new event id) auto-revokes the badge until
 * the signer re-attests the new version.
 */
export function isBoardAttested(
  labels: readonly NostrEvent[],
  issuerPubkey: string,
  namespace: string,
  coordinate: string,
  currentEventId: string,
): boolean {
  const label = collapseAttestationLabels(labels, issuerPubkey, namespace).get(coordinate);
  return !!label && label.attested && label.eventId === currentEventId;
}
