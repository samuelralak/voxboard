import type { Metadata } from "next";
import { HugeiconsIcon } from "@hugeicons/react";
import { Compass01Icon } from "@hugeicons/core-free-icons";
import { boardNaddr } from "@voxboard/protocol";
import { fetchDiscoverBoards } from "@/lib/nostr/server";
import { Shell } from "@/components/layout/shell";
import { BoardListItem } from "@/components/board/board-list-item";
import { NewBoardButton } from "@/components/board/new-board-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover boards",
  description: "Public feedback boards on Nostr.",
};

export default async function DiscoverPage() {
  const boards = await fetchDiscoverBoards(40);

  return (
    <Shell className="py-10 sm:py-16">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Browse</p>
          <h1 className="mt-3 font-display font-display-lg text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Discover boards
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Public feedback boards, owned by their creators and carried on Nostr. Open one to read
            ideas, vote on what matters, and watch them ship.
          </p>
        </div>
        <div className="shrink-0 sm:mt-1">
          <NewBoardButton />
        </div>
      </header>

      {boards.length === 0 ? (
        <div className="mx-auto mt-12 max-w-md rounded-md border border-border bg-surface p-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted">
            <HugeiconsIcon icon={Compass01Icon} size={20} strokeWidth={1.5} />
          </span>
          <p className="mt-3 font-display text-lg text-ink">No boards found</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            The discovery relays did not return any boards right now. Be the first to start one.
          </p>
          <div className="mt-4 flex justify-center">
            <NewBoardButton />
          </div>
        </div>
      ) : (
        <div className="mt-10">
          <p className="font-mono text-xs uppercase tracking-widest tabular-nums text-muted">
            <span className="text-ink">{boards.length}</span> boards
          </p>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {boards.map((board) => (
              <BoardListItem
                key={board.coordinate}
                board={board}
                href={`/b/${boardNaddr(board.ref, board.relays.map((relay) => relay.url))}`}
              />
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
