/**
 * attest.ts = Switchboard's Attestation::Attest — the GATE in front of the signer.
 *
 * Given a board coordinate and the authenticated requester, it: (1) fetches the board's current
 * kind-34550 event from relays (latest-wins), (2) runs the CONFORMANCE check by reusing the shared
 * `parseBoard` (so the service and the client can never disagree on "is this a valid board"), and
 * (3) runs the ADMISSION check (anti-sybil policy): the requester must OWN the board, or be a configured
 * operator. It returns a decision; signing/publishing is issue.ts's job. No private key is touched here.
 *
 * The admission gate is deliberately small and pluggable: v1 is owner-or-operator (automated on board
 * creation, where the create flow authenticates the owner via NIP-98). A tighter gate (NIP-05-verified
 * owner, a fee, WoT distance) drops in by extending `admit` without touching callers — see docs/ATTESTATION.md.
 */

import {
  KIND,
  communityCoordinate,
  isHex64,
  parseBoard,
  parseCommunityCoordinate,
  type Board,
  type NostrEvent,
} from "@voxboard/protocol";
import type { RelayClient } from "./relays";

export interface AttestRequest {
  /** the board coordinate `34550:<owner>:<slug>` to attest */
  coordinate: string;
  /** the authenticated requester pubkey (hex) — proven by NIP-98 at the endpoint */
  requester: string;
}

export type AttestDecision =
  | { ok: true; coordinate: string; eventId: string; board: Board }
  | { ok: false; reason: string };

export interface AttestDeps {
  client: RelayClient;
  /** returns true if the pubkey is a configured operator (may attest any board) */
  isOperator?: (pubkey: string) => boolean;
  /** query timeout override (ms) */
  maxWait?: number;
}

/** Fetch the board's current (latest-wins) kind-34550 event and parse it, or null if absent/non-conforming. */
export async function fetchBoard(
  client: RelayClient,
  coordinate: string,
  maxWait?: number,
): Promise<Board | null> {
  const ref = parseCommunityCoordinate(coordinate);
  if (!ref) return null;
  const { events } = await client.query(
    { kinds: [KIND.Community], authors: [ref.pubkey], "#d": [ref.slug] },
    maxWait,
  );
  // addressable replaceable: newest created_at wins, tiebreak lowest id (NIP-01)
  const latest = events
    .filter((e) => e.kind === KIND.Community && e.pubkey.toLowerCase() === ref.pubkey)
    .sort(byNewest)[0];
  if (!latest) return null;
  const board = parseBoard(latest);
  // defensive: the parsed board must address exactly this coordinate. Compare against the CANONICAL rebuild
  // (ref.pubkey is already lowercased) so a request coordinate with uppercase hex doesn't reject a legit board.
  if (!board || board.coordinate !== communityCoordinate(ref)) return null;
  return board;
}

function byNewest(a: NostrEvent, b: NostrEvent): number {
  if (b.created_at !== a.created_at) return b.created_at - a.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Run the gate. Returns a positive decision pinning the board's CURRENT event id (the anti-swap pin that
 * issue.ts puts in the label's `e` tag), or a rejection with a reason.
 */
export async function attestBoard(req: AttestRequest, deps: AttestDeps): Promise<AttestDecision> {
  const ref = parseCommunityCoordinate(req.coordinate);
  if (!ref) return { ok: false, reason: "not a board (34550) coordinate" };

  // fail closed on a malformed requester: the gate compares it to the board owner, so a non-hex/empty value
  // must never accidentally satisfy the comparison or reach isOperator. (NIP-98 proves it upstream; this is
  // defense in depth so attestBoard is safe even if a future caller passes an unauthenticated string.)
  const requester = req.requester.toLowerCase();
  if (!isHex64(requester)) return { ok: false, reason: "invalid requester pubkey" };

  const board = await fetchBoard(deps.client, req.coordinate, deps.maxWait);
  if (!board) return { ok: false, reason: "board not found or fails conformance (parseBoard)" };

  const owner = board.pubkey.toLowerCase();
  const admitted = requester === owner || deps.isOperator?.(requester) === true;
  if (!admitted) {
    return { ok: false, reason: "requester is neither the board owner nor an operator" };
  }

  return { ok: true, coordinate: board.coordinate, eventId: board.raw.id, board };
}
