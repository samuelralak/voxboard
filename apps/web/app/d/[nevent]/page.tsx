import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { decodeEntity } from "@voxboard/protocol";
import { fetchIdeaSnapshot, fetchIdeaThreadSnapshot } from "@/lib/nostr/server";
import { Shell } from "@/components/layout/shell";
import { IdeaView } from "@/components/board/idea-view";
import { BoardSubscriptionProvider } from "@/components/providers/board-subscription-provider";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ nevent: string }>;
}

function resolve(nevent: string) {
  const decoded = decodeEntity(nevent);
  if (!decoded || decoded.type !== "idea") return null;
  return { id: decoded.ref.id, relays: decoded.ref.relays ?? [] };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { nevent } = await params;
  const resolved = resolve(nevent);
  if (!resolved) return { title: "Idea not found" };

  const idea = await fetchIdeaSnapshot(resolved.id, resolved.relays);
  if (!idea) return { title: "Idea" };

  const description = idea.body ? idea.body.slice(0, 180) : `An idea on Voxboard.`;
  return {
    title: idea.title,
    description,
    openGraph: { title: idea.title, description, type: "article" },
    twitter: { card: "summary", title: idea.title, description },
  };
}

export default async function IdeaPage({ params }: PageProps) {
  const { nevent } = await params;
  const resolved = resolve(nevent);
  if (!resolved) notFound();

  const snap = await fetchIdeaThreadSnapshot(resolved.id, resolved.relays);
  // When the link pointed at a reply, the snapshot resolved up to its owning idea; anchor the whole view
  // (thread, votes, reply box) on that root id, not the reply id, so they stay consistent.
  const rootId = snap.idea?.id ?? resolved.id;

  return (
    <Shell>
      {/* The full board provider feeds the idea detail from the SAME derived view as the feed, so they
          agree on tally / moderation / reply count by construction. It persists across same-board idea
          navigation (coordinate-keyed subs are shared); IdeaView is key'd by the idea id so its per-idea
          optimistic state (posted replies, deletes, vote intent) resets and never leaks to the next idea. */}
      <BoardSubscriptionProvider
        board={snap.board}
        coordinate={snap.idea?.coordinate}
        initialIdeas={snap.thread}
        initialModeration={snap.moderation}
        initialVotes={snap.votes}
        initialDeletions={snap.deletions}
      >
        <IdeaView key={rootId} ideaId={rootId} initialIdea={snap.idea} />
      </BoardSubscriptionProvider>
    </Shell>
  );
}
