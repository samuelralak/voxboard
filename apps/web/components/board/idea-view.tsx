"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useProfileValue } from "@nostr-dev-kit/react";
import {
  KIND,
  boardNaddr,
  buildThread,
  countThread,
  isAuthorized,
  parseReply,
  type Idea,
  type NostrEvent,
  type Reply,
  type ThreadNode,
  type VoteTally,
} from "@voxboard/protocol";
import { useIdea } from "@/hooks/use-idea";
import { useVoting } from "@/hooks/use-voting";
import { useAuth } from "@/hooks/use-auth";
import { useDelete } from "@/hooks/use-delete";
import { useModeration } from "@/hooks/use-moderation";
import { useNip05Verify } from "@/hooks/use-nip05-verify";
import { useVisited } from "@/hooks/use-visited";
import { useWebOfTrust, trustedVotes } from "@/hooks/use-web-of-trust";
import { useZap } from "@/hooks/use-zaps";
import { useBoardSubscription } from "@/components/providers/board-subscription-provider";
import { useLoginGate } from "@/components/auth/login-gate";
import { buttonClasses } from "@/components/ui/button";
import { notNull } from "@/lib/nostr/event";
import { IdeaDetail } from "./idea-detail";
import { ReplyTree } from "./reply-tree";
import { ReplyBox } from "./reply-box";
import { FeedSkeleton } from "./feed-states";
import type { AuthorInfo } from "./feed-row";

const EMPTY_TALLY: VoteTally = { up: 0, down: 0, score: 0, byPubkey: new Map() };

/**
 * Drop replies (and their subtrees) the viewer has optimistically deleted this session, or that are past
 * the thread's lock cutoff. Mod-hide / ban / NIP-09 deletion are ALREADY applied upstream in
 * deriveBoardView (so the detail thread matches the feed's reply count by construction); only the
 * viewer-local optimistic delete and the per-thread lock are applied here.
 */
function pruneThread(nodes: ThreadNode[], deleted: Set<string>, lockCutoff: number | undefined): ThreadNode[] {
  const out: ThreadNode[] = [];
  for (const node of nodes) {
    if (deleted.has(node.reply.id)) continue;
    if (lockCutoff !== undefined && node.reply.createdAt > lockCutoff) continue;
    out.push({ ...node, children: pruneThread(node.children, deleted, lockCutoff) });
  }
  return out;
}

/**
 * Client idea view: the idea + its NIP-22 reply tree, with the board breadcrumb and live status. Reads
 * its data from the shared BoardSubscriptionProvider (mounted by the page) — the SAME derived `view` the
 * feed renders from — so the detail and the feed agree on tally / status / moderation / reply count by
 * construction. The only idea-local state is the optimistic posted-reply and optimistic-delete overlays.
 */
export function IdeaView({ ideaId, initialIdea }: { ideaId: string; initialIdea: Idea | null }) {
  const { board, view } = useBoardSubscription();
  const live = useIdea(ideaId);
  const viewIdea = useMemo(() => view.ideas.find((v) => v.idea.id === ideaId)?.idea ?? null, [view, ideaId]);
  const idea = live ?? initialIdea ?? viewIdea;

  // Replies posted this session, inserted optimistically: the live `#A` sub only echoes a published reply
  // back if it is open + filter-matching at publish time, so the signed reply is merged into the thread
  // here (dedupeById drops it once the relay echoes it into `view`).
  const [postedReplies, setPostedReplies] = useState<NostrEvent[]>([]);
  const onReplied = useCallback(
    (event: NostrEvent) =>
      setPostedReplies((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event])),
    [],
  );

  // Tally for THIS idea, read from the shared view so the displayed score and the "my vote" neutralization
  // move together (no +2 flicker) and exactly match the feed row.
  const tally = view.tallies.get(ideaId) ?? EMPTY_TALLY;
  const tallies = useMemo(() => new Map([[ideaId, tally]]), [ideaId, tally]);
  const voting = useVoting(useMemo(() => [ideaId], [ideaId]), tallies);

  const ideaStat = useMemo(() => view.ideas.find((v) => v.idea.id === ideaId), [view, ideaId]);
  const status = ideaStat?.status ?? undefined;
  const pinned = ideaStat?.pinned ?? false;

  // Thread: the shared (deleted/hidden/banned-filtered) replies + this session's optimistic posts, built
  // into the subtree rooted at the idea, then pruned by the lock cutoff + optimistic deletes.
  const postedReplyObjs = useMemo(() => postedReplies.map(parseReply).filter(notNull), [postedReplies]);
  const allReplies = useMemo<Reply[]>(() => {
    const byId = new Map<string, Reply>();
    for (const r of view.replies) byId.set(r.id, r);
    // An optimistic reply that has since been deleted/hidden/banned (this or another session) must not
    // revive from local state: re-apply the same suppression the upstream view already applied to replies.
    for (const r of postedReplyObjs)
      if (!byId.has(r.id) && !view.deleted.has(r.id) && !view.hidden.has(r.id) && !view.banned.has(r.pubkey))
        byId.set(r.id, r);
    return [...byId.values()];
  }, [view.replies, view.deleted, view.hidden, view.banned, postedReplyObjs]);
  const nodes = useMemo(() => buildThread(ideaId, allReplies), [ideaId, allReplies]);

  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const markDeleted = useCallback((id: string) => setDeletedIds((s) => new Set(s).add(id)), []);
  const lockCutoff = view.locks.get(ideaId);
  const visibleNodes = useMemo(() => pruneThread(nodes, deletedIds, lockCutoff), [nodes, deletedIds, lockCutoff]);
  const replyCount = useMemo(() => countThread(visibleNodes), [visibleNodes]);

  const profile = useProfileValue(idea?.pubkey);
  const router = useRouter();
  const { loggedIn, pubkey } = useAuth();
  const { promptLogin } = useLoginGate();
  const del = useDelete();
  const moderation = useModeration(board);

  const isOwner = Boolean(pubkey) && pubkey === idea?.pubkey;
  const onDeleteIdea = useCallback(async () => {
    if (!idea) return;
    await del(idea.id, KIND.Comment, idea.coordinate);
    router.push(board ? `/b/${boardNaddr(board.ref, board.relays.map((relay) => relay.url))}` : "/");
  }, [del, idea, board, router]);

  const onCopyLink = useCallback(() => {
    if (typeof window !== "undefined") void navigator.clipboard?.writeText(window.location.href);
  }, []);

  // Verify the author's NIP-05 (real round-trip) and record that the viewer opened this idea. Both hooks
  // run before the early returns to keep hook order stable.
  const nip05State = useNip05Verify(profile?.nip05, idea?.pubkey ?? "");
  const zap = useZap(idea?.id ?? null, idea?.pubkey ?? null, profile?.lud16 ?? null);
  const wot = useWebOfTrust();
  const inNetwork = Boolean(idea) && wot.isTrusted(idea!.pubkey);
  const trusted = useMemo(() => trustedVotes(tally.byPubkey, wot.isTrusted), [tally.byPubkey, wot.isTrusted]);
  const { markVisited } = useVisited();
  useEffect(() => {
    if (idea?.id) markVisited(idea.id);
  }, [idea?.id, markVisited]);

  if (live === undefined && !initialIdea && !viewIdea) {
    return (
      <div className="py-6">
        <FeedSkeleton rows={1} />
      </div>
    );
  }

  if (!idea) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-display text-lg text-ink">Idea not found</p>
        <p className="max-w-sm text-sm text-muted">
          We could not find this idea on the relays we checked.
        </p>
      </div>
    );
  }

  // Moderation parity with the feed: a retracted (NIP-09), mod-hidden, or banned-author idea must not
  // render on its permalink either (it would otherwise keep live vote/reply controls). On curated boards,
  // a not-yet-approved idea is hidden from everyone EXCEPT the owner/mods who review it. These view sets
  // are SSR-seeded and only GROW as data loads, so this never falsely flashes not-found during hydration.
  const viewerIsMod = pubkey && board ? isAuthorized(pubkey, board) : false;
  const suppressed =
    view.deleted.has(idea.id) ||
    view.hidden.has(idea.id) ||
    view.banned.has(idea.pubkey) ||
    (ideaStat !== undefined && !ideaStat.approved && !viewerIsMod);
  if (suppressed) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="font-display text-lg text-ink">Idea not available</p>
        <p className="max-w-sm text-sm text-muted">
          This idea has been removed or is not available on this board.
        </p>
      </div>
    );
  }

  const author: AuthorInfo = {};
  const name = profile?.displayName ?? profile?.name;
  if (name) author.name = name;
  if (profile?.picture) author.picture = profile.picture;
  if (profile?.nip05) author.nip05 = profile.nip05;

  return (
    <div>
      {board ? (
        <Link
          href={`/b/${boardNaddr(board.ref, board.relays.map((relay) => relay.url))}`}
          className="inline-flex items-center gap-1 pb-2 pt-6 text-sm text-muted transition-colors hover:text-ink"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={2} />
          {board.name}
        </Link>
      ) : null}

      <IdeaDetail
        idea={idea}
        author={author}
        tally={tally}
        replyCount={replyCount}
        {...(status ? { status } : {})}
        nip05State={nip05State}
        inNetwork={inNetwork}
        trustedUpvotes={trusted.upvotes}
        {...(profile?.lud16 ? { authorLud16: profile.lud16 } : {})}
        zapSats={zap.sats}
        onCopyLink={onCopyLink}
        myVote={voting.myVote(ideaId)}
        scoreDelta={voting.scoreDelta(ideaId)}
        onUp={() => voting.cast({ id: ideaId, pubkey: idea.pubkey, kind: KIND.Comment, coordinate: idea.coordinate }, "up")}
        onDown={() => voting.cast({ id: ideaId, pubkey: idea.pubkey, kind: KIND.Comment, coordinate: idea.coordinate }, "down")}
        votingDisabled={voting.isPending(ideaId)}
        canDelete={isOwner}
        onDelete={onDeleteIdea}
        moderation={moderation}
        pinned={pinned}
      />

      <section className="border-t border-border pt-6">
        {/* Inset the conversation to share the idea body's spine (it sits right of the vote ledger) so
            replies read as the same thread, not a separate column. Flush on mobile to keep width. */}
        <div className="sm:pl-13">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </h2>

          {loggedIn ? (
            <div className="mt-4">
              <ReplyBox
                boardRef={idea.board}
                boardRelay={board?.relays?.[0]?.url}
                parent={{ id: ideaId, pubkey: idea.pubkey, kind: KIND.Comment }}
                placeholder="Share your thoughts"
                onReplied={onReplied}
              />
            </div>
          ) : (
            <div className="mt-4">
              <button type="button" onClick={promptLogin} className={buttonClasses({ variant: "outline" })}>
                Log in to reply
              </button>
            </div>
          )}

          {visibleNodes.length > 0 ? (
            <div className="mt-6">
              <ReplyTree nodes={visibleNodes} board={board} onDeleted={markDeleted} onReplied={onReplied} moderation={moderation} />
            </div>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-muted">No replies yet. Be the first.</p>
          )}
        </div>
      </section>
    </div>
  );
}
