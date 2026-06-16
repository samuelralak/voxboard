import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { communityCoordinate, decodeEntity } from "@voxboard/protocol";
import { fetchBoardSnapshot } from "@/lib/nostr/server";
import { Shell } from "@/components/layout/shell";
import { BoardView } from "@/components/board/board-view";

// Relay-backed: render per request rather than prerender at build (caching is an M5 optimization).
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ naddr: string }>;
}

function resolve(naddr: string) {
  const decoded = decodeEntity(naddr);
  if (!decoded || decoded.type !== "board") return null;
  return {
    coordinate: communityCoordinate(decoded.ref),
    relays: decoded.relays,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { naddr } = await params;
  const resolved = resolve(naddr);
  if (!resolved) return { title: "Board not found" };

  const { board } = await fetchBoardSnapshot(resolved.coordinate, resolved.relays);
  if (!board) return { title: "Board" };

  const description = board.description ?? `Feedback for ${board.name}, on Nostr.`;
  return {
    title: board.name,
    description,
    openGraph: { title: board.name, description, type: "website" },
    twitter: { card: "summary_large_image", title: board.name, description },
  };
}

export default async function BoardPage({ params }: PageProps) {
  const { naddr } = await params;
  const resolved = resolve(naddr);
  if (!resolved) notFound();

  const { board, ideas, replies, moderation, votes, deletions } = await fetchBoardSnapshot(
    resolved.coordinate,
    resolved.relays,
  );

  return (
    <Shell>
      <BoardView
        coordinate={resolved.coordinate}
        initialBoard={board}
        initialIdeas={ideas}
        initialReplies={replies}
        initialModeration={moderation}
        initialVotes={votes}
        initialDeletions={deletions}
      />
    </Shell>
  );
}
