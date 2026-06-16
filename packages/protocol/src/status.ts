/**
 * Status = a NIP-32 label (kind 1985) authored by the board owner or a moderator, assigning one of
 * the 9 states to an idea. Honored only from authorized authors; latest-by-created_at wins (collapse
 * lives in moderation.ts). See docs/PROTOCOL.md.
 */

import { KIND, LABEL_NS, isStatus, type Status } from "./kinds";
import { communityCoordinate, type CommunityRef } from "./coords";
import {
  type EventTemplate,
  type NostrEvent,
  compactTags,
  getTags,
  now,
} from "./event";

export interface BuildStatusInput {
  /** the idea this status applies to */
  target: { id: string; relay?: string };
  board: CommunityRef;
  boardRelay?: string;
  state: Status;
  note?: string;
  /** when state is "duplicate", the canonical idea this duplicates */
  duplicateOf?: { id: string; relay?: string };
  createdAt?: number;
}

export function buildStatus(input: BuildStatusInput): EventTemplate {
  const tags: (string[] | undefined)[] = [
    ["L", LABEL_NS.status],
    ["l", input.state, LABEL_NS.status],
    input.target.relay ? ["e", input.target.id, input.target.relay] : ["e", input.target.id],
    input.boardRelay
      ? ["a", communityCoordinate(input.board), input.boardRelay]
      : ["a", communityCoordinate(input.board)],
  ];
  if (input.duplicateOf) {
    tags.push(["e", input.duplicateOf.id, input.duplicateOf.relay ?? "", "duplicate-of"]);
  }
  return {
    kind: KIND.Label,
    created_at: input.createdAt ?? now(),
    tags: compactTags(tags),
    content: input.note ?? "",
  };
}

export interface StatusLabel {
  /** label author (must be owner/mod to be honored) */
  pubkey: string;
  targetId: string;
  state: Status;
  note?: string;
  duplicateOf?: string;
  coordinate?: string;
  createdAt: number;
  raw: NostrEvent;
}

export function parseStatus(event: NostrEvent): StatusLabel | null {
  if (event.kind !== KIND.Label) return null;

  // must declare our status namespace and carry a valid status value under it
  const declaresNs = getTags(event.tags, "L").some((t) => t[1] === LABEL_NS.status);
  if (!declaresNs) return null;
  const labelTag = event.tags.find((t) => t[0] === "l" && t[2] === LABEL_NS.status);
  const state = labelTag?.[1];
  if (!state || !isStatus(state)) return null;

  let targetId: string | undefined;
  let duplicateOf: string | undefined;
  for (const t of getTags(event.tags, "e")) {
    if (t[3] === "duplicate-of") {
      if (!duplicateOf) duplicateOf = t[1];
    } else if (!targetId) {
      targetId = t[1];
    }
  }
  if (!targetId) return null;

  const aTag = event.tags.find((t) => t[0] === "a");
  const status: StatusLabel = {
    pubkey: event.pubkey,
    targetId,
    state,
    createdAt: event.created_at,
    raw: event,
  };
  if (event.content) status.note = event.content;
  if (duplicateOf) status.duplicateOf = duplicateOf;
  if (aTag?.[1]) status.coordinate = aTag[1];
  return status;
}
