"use client";

import { useState } from "react";
import { useProfileValue } from "@nostr-dev-kit/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CornerDownRightIcon, EyeOffIcon } from "@hugeicons/core-free-icons";
import { KIND, type Board, type NostrEvent, type ThreadNode } from "@voxboard/protocol";
import { Avatar } from "@/components/ui/avatar";
import { InNetworkBadge, VerifiedChip } from "@/components/ui/chip";
import { useAuth } from "@/hooks/use-auth";
import { useDelete } from "@/hooks/use-delete";
import { useNip05Verify } from "@/hooks/use-nip05-verify";
import { useWebOfTrust } from "@/hooks/use-web-of-trust";
import { useLoginGate } from "@/components/auth/login-gate";
import type { Moderation } from "@/hooks/use-moderation";
import { cleanName, fullTime, isoTime, npubShort, timeAgo } from "@/lib/format";
import { ReplyBox } from "./reply-box";
import { DeleteButton } from "./delete-button";

// Past this depth the indentation stops marching right (the left rule still marks nesting), so a long
// self-reply chain can't run reply text off-screen and force page-wide horizontal scroll on mobile.
const MAX_INDENT_DEPTH = 6;

/** Renders a threaded reply tree (NIP-22). Indentation + a left rule mark nesting depth. */
export function ReplyTree({
  nodes,
  board,
  onDeleted,
  onReplied,
  moderation,
  depth = 0,
}: {
  nodes: ThreadNode[];
  board: Board | null | undefined;
  onDeleted: (id: string) => void;
  onReplied?: (event: NostrEvent) => void;
  moderation?: Moderation;
  depth?: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="space-y-4">
      {nodes.map((node) => (
        <ReplyNode
          key={node.reply.id}
          node={node}
          board={board}
          onDeleted={onDeleted}
          onReplied={onReplied}
          moderation={moderation}
          depth={depth}
        />
      ))}
    </div>
  );
}

function ReplyNode({
  node,
  board,
  onDeleted,
  onReplied,
  moderation,
  depth,
}: {
  node: ThreadNode;
  board: Board | null | undefined;
  onDeleted: (id: string) => void;
  onReplied?: (event: NostrEvent) => void;
  moderation?: Moderation;
  depth: number;
}) {
  const { reply, children } = node;
  const { loggedIn, pubkey } = useAuth();
  const { promptLogin } = useLoginGate();
  const del = useDelete();
  const profile = useProfileValue(reply.pubkey);
  const [replying, setReplying] = useState(false);

  const cleaned = cleanName(profile?.displayName ?? profile?.name);
  const name = cleaned || npubShort(reply.pubkey);
  const isNpub = cleaned.length === 0;
  const nip05State = useNip05Verify(profile?.nip05, reply.pubkey);
  const inNetwork = useWebOfTrust().isTrusted(reply.pubkey);
  const isMine = Boolean(pubkey) && pubkey === reply.pubkey;

  const onReplyClick = () => {
    if (!loggedIn) {
      promptLogin();
      return;
    }
    setReplying(true);
  };

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <Avatar pubkey={reply.pubkey} src={profile?.picture} alt={name} size="sm" />
        <span className={isNpub ? "truncate font-mono text-ink" : "truncate font-medium text-ink"}>{name}</span>
        {inNetwork ? <InNetworkBadge /> : null}
        {profile?.nip05 ? <VerifiedChip nip05={profile.nip05} state={nip05State} /> : null}
        <time suppressHydrationWarning dateTime={isoTime(reply.createdAt)} title={fullTime(reply.createdAt)}>{timeAgo(reply.createdAt)}</time>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap break-words pl-8 text-sm leading-relaxed text-ink">{reply.body}</div>

      <div className="mt-1.5 flex items-center gap-1 pl-8">
        <button
          type="button"
          onClick={onReplyClick}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <HugeiconsIcon icon={CornerDownRightIcon} size={13} strokeWidth={2} />
          Reply
        </button>
        {isMine ? (
          <DeleteButton
            onConfirm={async () => {
              await del(reply.id, KIND.Comment);
              onDeleted(reply.id);
            }}
          />
        ) : null}
        {moderation?.canModerate && !isMine ? (
          <button
            type="button"
            onClick={async () => {
              await moderation.hide(reply.id);
              onDeleted(reply.id);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-status-declined focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <HugeiconsIcon icon={EyeOffIcon} size={13} strokeWidth={2} />
            Hide
          </button>
        ) : null}
      </div>

      {replying ? (
        <div className="mt-2 pl-8">
          <ReplyBox
            boardRef={reply.board}
            boardRelay={board?.relays?.[0]?.url}
            parent={{ id: reply.id, pubkey: reply.pubkey, kind: KIND.Comment }}
            autoFocus
            placeholder={`Reply to ${name}`}
            onDone={() => setReplying(false)}
            onReplied={onReplied}
          />
        </div>
      ) : null}

      {children.length > 0 ? (
        <div
          className={
            depth < MAX_INDENT_DEPTH
              ? "mt-3 ml-3 border-l border-border pl-4" // rule runs through the size-6 avatar's midline
              : "mt-3 border-l border-border pl-3" // capped: keep the nesting rule, stop marching right
          }
        >
          <ReplyTree nodes={children} board={board} onDeleted={onDeleted} onReplied={onReplied} moderation={moderation} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  );
}
