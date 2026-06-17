"use client";

/** Dev preview of the idea-detail + threaded replies, with mock data. Not linked in navigation. */

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import {
  buildIdea,
  buildReply,
  buildThread,
  countThread,
  parseIdea,
  parseReply,
  type NostrEvent,
  type Reply,
} from "@voxboard/protocol";
import { Shell } from "@/components/layout/shell";
import { IdeaDetail } from "@/components/board/idea-detail";
import { ReplyTree } from "@/components/board/reply-tree";

const SIG = "0".repeat(128);
const NOW = Math.floor(Date.now() / 1000);
const OWNER = "a1".repeat(32);
const POSTER = "c3".repeat(32);
const hx = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const BOARD = { pubkey: OWNER, slug: "voxboard" };

function sign(
  t: { kind: number; created_at: number; tags: string[][]; content: string },
  pubkey: string,
  id: string,
): NostrEvent {
  return { ...t, pubkey, id, sig: SIG };
}

const idea = parseIdea(
  sign(
    buildIdea({
      board: BOARD,
      title: "Export the roadmap as CSV / JSON, ideally with a per-status-column public API endpoint",
      body: "Would love to pull the roadmap into our own planning tools.\n\nA simple CSV (and ideally JSON) export per status column would be perfect, even just the public columns.",
      categories: ["feature"],
      createdAt: NOW - 27 * 3600,
    }),
    POSTER,
    hx(0x10),
  ),
)!;

function reply(
  id: string,
  parentId: string,
  parentPubkey: string,
  authorPubkey: string,
  body: string,
  ageH: number,
): Reply {
  return parseReply(
    sign(
      buildReply({
        board: BOARD,
        parent: { id: parentId, pubkey: parentPubkey, kind: 1111 },
        body,
        createdAt: NOW - ageH * 3600,
      }),
      authorPubkey,
      id,
    ),
  )!;
}

const RA = hx(0xa1);
const RA1 = hx(0xa2);
const RB = hx(0xb1);
const replies = [
  reply(RA, idea.id, POSTER, hx(0x44), "Strong +1. JSON especially, we'd wire it straight into a dashboard.", 20),
  reply(RA1, RA, hx(0x44), hx(0x55), "Same here. Per-column export would be ideal so we can map statuses 1:1.", 14),
  reply(RB, idea.id, POSTER, hx(0x66), "Could this include the vote counts per item too?", 6),
];
const nodes = buildThread(idea.id, replies);

export default function IdeaPreview() {
  const replyCount = countThread(nodes);
  return (
    <Shell>
      <div className="inline-flex items-center gap-1 py-4 text-sm text-muted">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={2} />
        Voxboard feedback
      </div>
      <IdeaDetail
        idea={idea}
        author={{ name: "pckt", nip05: "pckt.blog" }}
        tally={{ up: 33, down: 2, score: 31, byPubkey: new Map() }}
        replyCount={replyCount}
        status="planned"
        zapSats={880}
        onCopyLink={() => {}}
        canDelete
        onDelete={async () => {}}
      />
      <section className="border-t border-border pt-6">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted">
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </h2>
        <p className="mt-2 text-sm text-muted">Log in to reply.</p>
        <div className="mt-5">
          <ReplyTree nodes={nodes} board={null} onDeleted={() => {}} />
        </div>
      </section>
    </Shell>
  );
}
