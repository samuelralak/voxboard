import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { boardNaddr, decodeEntity } from "@voxboard/protocol";
import { fetchOrgBoards, resolveNip05 } from "@/lib/nostr/server";
import { Shell } from "@/components/layout/shell";
import { Avatar } from "@/components/ui/avatar";
import { BoardListItem } from "@/components/board/board-list-item";
import { npubShort } from "@/lib/format";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ handle: string }>;
}

async function resolveActor(
  handle: string,
): Promise<{ pubkey: string; relays: string[] } | null> {
  const decoded = decodeEntity(handle);
  if (decoded?.type === "npub") return { pubkey: decoded.pubkey, relays: [] };
  return resolveNip05(handle);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const display = decodeURIComponent(handle);
  return { title: display, description: `Feedback boards by ${display} on Voxboard.` };
}

export default async function OrgPage({ params }: PageProps) {
  const { handle } = await params;
  const display = decodeURIComponent(handle);
  const actor = await resolveActor(display);
  if (!actor) notFound();

  const boards = await fetchOrgBoards(actor.pubkey, actor.relays);

  return (
    <Shell className="py-8">
      <header className="flex items-center gap-4 border-b border-border pb-6">
        <Avatar pubkey={actor.pubkey} size="lg" />
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{display}</h1>
          <p className="mt-1 font-mono text-xs text-muted">{npubShort(actor.pubkey)}</p>
        </div>
      </header>

      {boards.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 py-16 text-center">
          <p className="font-display text-lg text-ink">No boards yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            This account has not created any feedback boards on Nostr yet.
          </p>
        </div>
      ) : (
        <div className="mt-6 divide-y divide-border border-b border-border">
          {boards.map((board) => (
            <BoardListItem
              key={board.coordinate}
              board={board}
              href={`/b/${boardNaddr(board.ref, board.relays.map((relay) => relay.url))}`}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}
