"use client";

import type { Board, Idea, NostrEvent } from "@voxboard/protocol";
import { useBoard } from "@/hooks/use-board";
import { BoardSubscriptionProvider } from "@/components/providers/board-subscription-provider";
import { BoardFeed } from "./board-feed";
import { FeedSkeleton } from "./feed-states";

/**
 * Client board view. Prefers the live board (kind 34550) but renders immediately from the SSR snapshot
 * (`initialBoard` + `initialIdeas`) so the page paints before relays answer. Live data supersedes on
 * arrival; the ideas are unioned with the live feed so the list never regresses.
 */
export function BoardView({
  coordinate,
  initialBoard,
  initialIdeas = [],
  initialReplies = [],
  initialModeration = [],
  initialVotes = [],
  initialDeletions = [],
}: {
  coordinate: string;
  initialBoard: Board | null;
  initialIdeas?: Idea[];
  initialReplies?: NostrEvent[];
  initialModeration?: NostrEvent[];
  initialVotes?: NostrEvent[];
  initialDeletions?: NostrEvent[];
}) {
  const live = useBoard(coordinate);

  if (live === undefined && !initialBoard) {
    return (
      <div className="py-8">
        <FeedSkeleton />
      </div>
    );
  }

  const board = live ?? initialBoard;
  if (!board) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-display text-lg text-ink">Board not found</p>
        <p className="max-w-sm text-sm text-muted">
          No board exists at this address on the relays we checked.
        </p>
      </div>
    );
  }

  return (
    <BoardSubscriptionProvider
      board={board}
      initialIdeas={initialIdeas.map((idea) => idea.raw)}
      initialReplies={initialReplies}
      initialModeration={initialModeration}
      initialVotes={initialVotes}
      initialDeletions={initialDeletions}
    >
      <BoardFeed board={board} />
    </BoardSubscriptionProvider>
  );
}
