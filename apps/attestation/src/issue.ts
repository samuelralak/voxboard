/**
 * issue.ts = Switchboard's Attestation::Issue — the only place that touches the signer to MINT attestation
 * events, keeping the two carriers in lockstep: a per-board label (carrier 2) AND the addressable
 * allowlist set (carrier 1). See docs/ATTESTATION.md.
 *
 * SOURCE OF TRUTH = the per-board LABELS. They are durable (one per attested board, only ever superseded
 * by a "delisted" label), and they carry the anti-swap `e` pin. The SET is a DERIVED index of which
 * coordinates discover should show.
 *
 * The set-shrink footgun: recomputing the set from a possibly-incomplete relay read could silently
 * de-list boards. Defenses:
 *   - ADD is MONOTONIC — newSet = union(currentSet, attested-labels, [coordinate]). The union of two
 *     independent best-effort reads PLUS the new coord means a partial read can never DROP a listed board;
 *     the set only grows on an add (worst case: a board we couldn't see anywhere is transiently
 *     under-listed, then healed on the next op / the Phase 6 reconcile).
 *   - REVOKE removes EXPLICITLY (filter), after a delist label is published, so a read race can't keep a
 *     revoked board listed.
 * The residual (a delisted board lingering in a stale set during an unrelated add) is a known v1 limit,
 * closed by the Phase 6 persistent store + reconcile.
 */

import {
  ATTESTATION,
  KIND,
  buildAttestationLabel,
  buildAttestationSet,
  buildDelistLabel,
  collapseAttestationLabels,
  communityCoordinate,
  now,
  parseCommunityCoordinate,
  selectLatestAttestationSet,
  type AttestationLabel,
  type NostrEvent,
} from "@voxboard/protocol";
import type { Signer } from "./signer";
import type { RelayClient } from "./relays";
import { fetchBoard } from "./attest";
import { RelayUnavailableError } from "./errors";

/**
 * CONCURRENCY: issueAttestation/revokeAttestation are read-modify-write on the addressable set, which is
 * latest-created_at-wins. v1 assumes a SINGLE serialized writer per issuer (one instance / a per-issuer
 * queue). Two instances attesting different boards concurrently can lose-update the set (each per-board
 * LABEL still lands, so the badge survives and the next op / Phase 6 reconcile heals the set). The Phase 6
 * persistent store provides the serialized/compare-and-set writer that closes this. See docs/ATTESTATION.md.
 */

/** Bound the label history read. Labels are non-replaceable and accumulate; a truncated read can only
 *  UNDER-count the label floor, never shrink the set (the monotonic union over the addressable set is the
 *  real floor), so this is safe. Generous enough to cover thousands of boards' latest labels. */
const LABEL_READ_LIMIT = 5000;

export interface IssueDeps {
  signer: Signer;
  client: RelayClient;
  /** env-scoped attestation namespace (attestationNamespace(env)) — must match the web app's */
  namespace: string;
  maxWait?: number;
}

export interface IssueResult {
  /** the per-board label that was published (or the already-current one, when idempotent) */
  label: NostrEvent | null;
  /** the republished allowlist set, or null when the coordinate list was unchanged */
  set: NostrEvent | null;
  /** true when the board was already attested at this exact event id (nothing republished) */
  idempotent: boolean;
  /** the full attested coordinate list after the operation */
  coordinates: string[];
}

interface CurrentState {
  /** coordinates in the issuer's latest verified allowlist set ([] if none) */
  setCoords: string[];
  /** created_at of that set (0 if none) — used to keep republished sets strictly newer */
  setCreatedAt: number;
  /** the issuer's per-board labels, collapsed to the latest per coordinate */
  labels: Map<string, AttestationLabel>;
  /** true when BOTH reads came back from ZERO reachable relays — a blind read, not a genuine empty */
  blind: boolean;
}

/** Read the issuer's current allowlist set + per-board labels in one pass, recording reachability. */
async function readState(deps: IssueDeps): Promise<CurrentState> {
  const [setRes, labelRes] = await Promise.all([
    deps.client.query(
      { kinds: [ATTESTATION.setKind], authors: [deps.signer.issuerPubkey], "#d": [ATTESTATION.setIdentifier] },
      deps.maxWait,
    ),
    deps.client.query(
      { kinds: [KIND.Label], authors: [deps.signer.issuerPubkey], "#L": [deps.namespace], limit: LABEL_READ_LIMIT },
      deps.maxWait,
    ),
  ]);

  // the latest verified issuer set (shared selection: newest created_at, NIP-01 lowest-id tiebreak)
  const latest = selectLatestAttestationSet(setRes.events, deps.signer.issuerPubkey, deps.namespace);

  return {
    setCoords: latest?.coordinates ?? [],
    setCreatedAt: latest?.createdAt ?? 0,
    labels: collapseAttestationLabels(labelRes.events, deps.signer.issuerPubkey, deps.namespace),
    blind: setRes.responded === 0 && labelRes.responded === 0,
  };
}

function attestedCoords(labels: Map<string, AttestationLabel>): string[] {
  const out: string[] = [];
  for (const [coord, label] of labels) if (label.attested) out.push(coord);
  return out;
}

const unique = (coords: string[]): string[] => [...new Set(coords)];

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/** Publish, failing closed if the event reached NO relay (a swallowed publish would falsely report success). */
async function publishOrThrow(deps: IssueDeps, event: NostrEvent, what: string): Promise<void> {
  const result = await deps.client.publish(event);
  if (result.ok === 0) {
    throw new RelayUnavailableError(`failed to publish ${what} to any relay (${result.failed} relay(s) failed)`);
  }
}

/**
 * Attest a board: publish its per-board label (pinning the current event id) and, if the coordinate list
 * changed, republish the allowlist set. Idempotent when the board is already attested at this event id.
 */
export async function issueAttestation(
  decision: { coordinate: string; eventId: string },
  deps: IssueDeps,
): Promise<IssueResult> {
  const { coordinate, eventId } = decision;
  const state = await readState(deps);

  // FAIL CLOSED on a blind read. Recomputing the addressable set from ZERO reachable relays could publish a
  // shrunken set (worst case a 1-coordinate set) that supersedes the real allowlist = mass silent de-list.
  // A genuine genesis read is NOT blind (a reachable relay simply returns no set), so genesis still works.
  if (state.blind) {
    throw new RelayUnavailableError("blind relay read (no reachable relays); refusing to recompute the allowlist");
  }

  // idempotency: the latest label already pins THIS event id and the coordinate is already in the set.
  const existing = state.labels.get(coordinate);
  if (existing?.attested && existing.eventId === eventId && state.setCoords.includes(coordinate)) {
    return { label: existing.raw, set: null, idempotent: true, coordinates: state.setCoords };
  }

  // 1) the durable per-board label (source of truth + anti-swap pin). Monotonic created_at: strictly newer
  //    than any prior label for this coordinate so an off->on (re-attest after delist) or same-second
  //    transition always wins the latest-from-issuer collapse.
  const labelCreatedAt = Math.max(now(), (existing?.createdAt ?? 0) + 1);
  const label = deps.signer.sign(
    buildAttestationLabel({ coordinate, eventId, namespace: deps.namespace, createdAt: labelCreatedAt }),
  );
  await publishOrThrow(deps, label, "attestation label");

  // 2) monotonic union; republish the set only if membership actually changed (a board-edit re-attest
  //    changes only the label's event id, not the set, so this avoids needless set churn).
  const coordinates = unique([...state.setCoords, ...attestedCoords(state.labels), coordinate]);
  let set: NostrEvent | null = null;
  if (!sameMembers(coordinates, state.setCoords)) {
    // monotonic created_at so the republished set strictly supersedes the one it replaces (same-second / skew).
    const setCreatedAt = Math.max(now(), state.setCreatedAt + 1);
    set = deps.signer.sign(buildAttestationSet({ coordinates, namespace: deps.namespace, createdAt: setCreatedAt }));
    await publishOrThrow(deps, set, "allowlist set");
  }

  return { label, set, idempotent: false, coordinates };
}

/**
 * Revoke a board: publish a "delisted" label (the durable per-board off-state + badge revoke) and
 * republish the allowlist set with the coordinate explicitly removed.
 */
export async function revokeAttestation(
  input: { coordinate: string; eventId?: string },
  deps: IssueDeps,
): Promise<IssueResult> {
  // canonicalize (lowercase pubkey) so the coordinate matches the canonical set/label keys; otherwise an
  // operator-supplied mixed-case coordinate wouldn't match and the revoke would silently no-op.
  const ref = parseCommunityCoordinate(input.coordinate);
  const coordinate = ref ? communityCoordinate(ref) : input.coordinate;
  const state = await readState(deps);

  // FAIL CLOSED on a blind read: a revoke recomputes the set too, and a blind read could republish a
  // shrunken set or fail to actually drop the coordinate. The caller retries when relays are reachable.
  if (state.blind) {
    throw new RelayUnavailableError("blind relay read (no reachable relays); refusing to recompute the allowlist");
  }

  // Recompute the set WITHOUT the coordinate. Union gives the floor (preserve other boards); the explicit
  // filter guarantees removal regardless of read races. Publish the SET FIRST (the authoritative discover
  // gate), so a partial failure still removes the board from discover even if the badge label lands late.
  // Only republish when membership actually changed (no needless supersede when the coord wasn't listed).
  const coordinates = unique([...state.setCoords, ...attestedCoords(state.labels)]).filter(
    (c) => c !== coordinate,
  );
  let set: NostrEvent | null = null;
  if (!sameMembers(coordinates, state.setCoords)) {
    const setCreatedAt = Math.max(now(), state.setCreatedAt + 1);
    set = deps.signer.sign(buildAttestationSet({ coordinates, namespace: deps.namespace, createdAt: setCreatedAt }));
    await publishOrThrow(deps, set, "allowlist set");
  }

  // delist label (the badge off-state): pin the event id we were given, else the one the current label
  // pinned, else the board's CURRENT id (so the badge still revokes even when the label read was partial;
  // a delist revokes regardless of which id it pins, but the `e` tag needs a concrete value). Monotonic
  // created_at so the delist strictly supersedes the current attested label (never loses a same-second tie).
  const current = state.labels.get(coordinate);
  const eventId =
    input.eventId ?? current?.eventId ?? (await fetchBoard(deps.client, coordinate, deps.maxWait))?.raw.id;
  let label: NostrEvent | null = null;
  if (eventId) {
    const labelCreatedAt = Math.max(now(), (current?.createdAt ?? 0) + 1);
    label = deps.signer.sign(
      buildDelistLabel({ coordinate, eventId, namespace: deps.namespace, createdAt: labelCreatedAt }),
    );
    await publishOrThrow(deps, label, "delist label");
  }

  return { label, set, idempotent: false, coordinates };
}
