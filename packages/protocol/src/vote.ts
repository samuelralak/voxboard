/**
 * Vote = NIP-25 reaction (kind 7). content "+" (or empty) is an upvote, "-" is a downvote; anything
 * else (an emoji) is NOT a vote. The target is the LAST `e` tag. Reactions are append-only and a
 * pubkey may publish many, so authoritative counts require deduping to latest-per-pubkey and treating
 * +/- as a toggle. See docs/PROTOCOL.md "counting problem".
 */

import { KIND } from "./kinds";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getLastTag,
  now,
} from "./event";

export type VoteDirection = "up" | "down";

export interface VoteTarget {
  /** the kind-1111 idea or reply being voted on */
  id: string;
  pubkey: string;
  kind?: number;
  relay?: string;
  /** the board coordinate (34550:pubkey:d) the target belongs to. Emitted as an `A` tag so the vote is
   *  discoverable by a stable coordinate-keyed `#A` subscription, not only by the target event id. */
  coordinate?: string;
}

export interface BuildVoteInput {
  target: VoteTarget;
  direction: VoteDirection;
  createdAt?: number;
}

export function buildVote(input: BuildVoteInput): EventTemplate {
  const { target } = input;
  const tags = compactTags([
    ["e", target.id, target.relay ?? "", target.pubkey],
    target.relay ? ["p", target.pubkey, target.relay] : ["p", target.pubkey],
    ["k", String(target.kind ?? KIND.Comment)],
    // Board coordinate (NIP-22-style uppercase root scope) so the vote is reachable by a stable `#A`
    // subscription. Omitted (back-compat) when the caller has no coordinate; parseVote ignores it
    // (tallying still keys off the `e` target), so old/cross-client votes are unaffected.
    target.coordinate ? ["A", target.coordinate] : undefined,
  ]);
  return {
    kind: KIND.Reaction,
    created_at: input.createdAt ?? now(),
    tags,
    content: input.direction === "up" ? "+" : "-",
  };
}

export interface Vote {
  id: string;
  pubkey: string;
  targetId: string;
  targetAuthor?: string;
  direction: VoteDirection;
  createdAt: number;
  raw: NostrEvent;
}

export function parseVote(event: NostrEvent): Vote | null {
  if (event.kind !== KIND.Reaction) return null;
  const content = event.content.trim();
  let direction: VoteDirection;
  if (content === "+" || content === "") direction = "up";
  else if (content === "-") direction = "down";
  else return null; // emoji / custom reaction: not a vote

  const eTag = getLastTag(event.tags, "e");
  const targetId = eTag?.[1];
  if (!targetId) return null;

  const vote: Vote = {
    id: event.id,
    pubkey: event.pubkey,
    targetId,
    direction,
    createdAt: event.created_at,
    raw: event,
  };
  if (eTag[3]) vote.targetAuthor = eTag[3];
  return vote;
}

export interface VoteTally {
  up: number;
  down: number;
  /** up - down */
  score: number;
  /** the deduped (latest) direction each pubkey holds */
  byPubkey: Map<string, VoteDirection>;
}

/** Reduce a set of votes (for ONE target) to an authoritative tally, latest-per-pubkey. */
export function tallyVotes(votes: Vote[]): VoteTally {
  const latest = new Map<string, Vote>();
  for (const v of votes) {
    const prev = latest.get(v.pubkey);
    if (
      !prev ||
      v.createdAt > prev.createdAt ||
      (v.createdAt === prev.createdAt && v.id < prev.id) // NIP-01 tiebreak: lowest id wins
    ) {
      latest.set(v.pubkey, v);
    }
  }
  let up = 0;
  let down = 0;
  const byPubkey = new Map<string, VoteDirection>();
  for (const [pubkey, v] of latest) {
    byPubkey.set(pubkey, v.direction);
    if (v.direction === "up") up++;
    else down++;
  }
  return { up, down, score: up - down, byPubkey };
}

/** Group votes by target id and tally each. Convenience for the aggregator. */
export function tallyVotesByTarget(votes: Vote[]): Map<string, VoteTally> {
  const grouped = new Map<string, Vote[]>();
  for (const v of votes) {
    const list = grouped.get(v.targetId);
    if (list) list.push(v);
    else grouped.set(v.targetId, [v]);
  }
  const out = new Map<string, VoteTally>();
  for (const [targetId, list] of grouped) out.set(targetId, tallyVotes(list));
  return out;
}
