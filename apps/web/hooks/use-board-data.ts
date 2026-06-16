"use client";

import { useMemo } from "react";
import type { Idea, Reply, Status, VoteTally } from "@voxboard/protocol";
import { useZaps } from "./use-zaps";
import { useBoardSubscription } from "@/components/providers/board-subscription-provider";

export interface IdeaRow {
  idea: Idea;
  tally: VoteTally;
  status?: Status;
  replyCount: number;
  pinned: boolean;
  /** validated, deduped zap total in sats (0 when there are no trustworthy zaps) */
  zapSats: number;
}

export interface BoardData {
  rows: IdeaRow[];
  replies: Reply[];
  eose: boolean;
  /** curated boards only: ideas awaiting an owner/mod approval (empty otherwise) */
  pending: Idea[];
}

/**
 * Board feed view-model, projected from the shared BoardSubscriptionProvider's `deriveBoardView` (the
 * SAME pure function the indexer projects deriveBoardStats from, so client and indexer can never
 * disagree). This hook only: (1) drops hidden / banned-author / unapproved ideas from the visible feed,
 * (2) overlays validated zap totals (a client-only overlay, outside the shared pure view), and (3) maps
 * to IdeaRow. All deletion / moderation / trust resolution lives in deriveBoardView upstream.
 */
export function useBoardData(): BoardData {
  const { view, eose } = useBoardSubscription();

  // Visible feed: hidden, banned-author, and (curated) unapproved ideas are filtered out. deriveBoardView
  // already excludes deleted ideas and encodes the curated/approval rule in each idea's `approved` flag.
  const visible = useMemo(
    () => view.ideas.filter((v) => !view.hidden.has(v.idea.id) && !view.banned.has(v.idea.pubkey) && v.approved),
    [view],
  );

  const visibleIds = useMemo(() => visible.map((v) => v.idea.id), [visible]);
  const authorByTarget = useMemo(() => new Map(visible.map((v) => [v.idea.id, v.idea.pubkey])), [visible]);
  const zaps = useZaps(visibleIds, authorByTarget);

  const rows = useMemo<IdeaRow[]>(
    () =>
      visible.map((v) => {
        const row: IdeaRow = {
          idea: v.idea,
          tally: v.tally,
          replyCount: v.replyCount,
          pinned: v.pinned,
          zapSats: zaps.get(v.idea.id)?.sats ?? 0,
        };
        if (v.status) row.status = v.status;
        return row;
      }),
    [visible, zaps],
  );

  return { rows, replies: view.replies, eose, pending: view.pending };
}
