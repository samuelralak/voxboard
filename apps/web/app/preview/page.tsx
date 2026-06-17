"use client";

/**
 * Dev preview / component gallery for the board feed. Uses mock data (no live Nostr boards exist yet)
 * so the read-path UI can be reviewed and screenshotted. Not linked in navigation; safe to remove once
 * real boards are browsable. The real board route wires the same components to live hooks.
 */

import { useMemo, useState } from "react";
import {
  buildBoard,
  buildIdea,
  parseBoard,
  parseIdea,
  type NostrEvent,
  type Status,
} from "@voxboard/protocol";
import type { IdeaRow } from "@/hooks/use-board-data";
import { Shell } from "@/components/layout/shell";
import { BoardHeader } from "@/components/board/board-header";
import { FeedToolbar, type SortKey } from "@/components/board/feed-toolbar";
import { FeedRow, type AuthorInfo } from "@/components/board/feed-row";
import { sortAndFilter } from "@/components/board/board-feed";

const SIG = "0".repeat(128);
const NOW = Math.floor(Date.now() / 1000);
const OWNER = "a1".repeat(32);
const hx = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

function sign(
  template: { kind: number; created_at: number; tags: string[][]; content: string },
  pubkey: string,
  id: string,
): NostrEvent {
  return { ...template, pubkey, id, sig: SIG };
}

const board = parseBoard(
  sign(
    buildBoard({
      slug: "voxboard",
      name: "Voxboard feedback",
      description:
        "A little meta: tell us what to build for Voxboard itself. Post an idea, vote on what matters, and watch it move from planned to shipped.",
      categories: ["feature", "bug", "question", "ux", "performance", "mobile", "docs"],
      mode: "open",
    }),
    OWNER,
    hx(1),
  ),
)!;

interface Mock {
  title: string;
  body?: string;
  cats: string[];
  ageH: number;
  up: number;
  down: number;
  status?: Status;
  replies: number;
  zaps?: number;
  author: AuthorInfo;
  pk: string;
}

const MOCKS: Mock[] = [
  {
    title: "Dark mode keeps resetting to light on reload",
    body: "Every time I refresh the board my theme snaps back to light even though I picked dark. Seems like the preference isn't persisting between sessions.",
    cats: ["bug"],
    ageH: 5,
    up: 44,
    down: 2,
    status: "under-review",
    replies: 8,
    zaps: 2100,
    author: { name: "Alice Rivera", nip05: "alice@rivera.dev" },
    pk: hx(0x21),
  },
  {
    title: "Export the roadmap as CSV / JSON",
    body: "Would love to pull the roadmap into our own planning tools. A simple CSV (and ideally JSON) export per status column would be perfect.",
    cats: ["feature"],
    ageH: 27,
    up: 33,
    down: 2,
    status: "planned",
    replies: 12,
    zaps: 880,
    author: { name: "pckt", nip05: "pckt.blog" },
    pk: hx(0x33),
  },
  {
    title: "Zaps on individual comments, not just ideas",
    body: "Right now I can zap a post but not a great reply underneath it. Let me reward the best comments too.",
    cats: ["feature"],
    ageH: 49,
    up: 28,
    down: 1,
    status: "in-progress",
    replies: 5,
    zaps: 5400,
    author: { name: "Carol", nip05: "carol@nostrplebs.com" },
    pk: hx(0x44),
  },
  {
    title: "Keyboard shortcuts: j / k to move, u to upvote",
    body: "Power users would fly through a busy board with vim-style navigation.",
    cats: ["feature"],
    ageH: 76,
    up: 19,
    down: 0,
    status: "implemented",
    replies: 3,
    author: { name: "dave" },
    pk: hx(0x55),
  },
  {
    title: "Small typo in the onboarding copy",
    body: '"Sign in with your nostr key" should be capitalized as "Nostr".',
    cats: ["bug"],
    ageH: 6,
    up: 4,
    down: 0,
    replies: 1,
    author: { name: "erin" },
    pk: hx(0x66),
  },
  {
    title: "Why isn't my post showing on the board?",
    body: "First time posting here. I published an idea from my client but it doesn't appear in the feed. Did I tag the community wrong?",
    cats: ["question"],
    ageH: 9,
    up: 2,
    down: 1,
    status: "open",
    replies: 2,
    author: { name: "frank", nip05: "frank@example.com" },
    pk: hx(0x77),
  },
];

function toRow(mock: Mock, index: number): { row: IdeaRow; author: AuthorInfo; zaps: number } {
  const idea = parseIdea(
    sign(
      buildIdea({
        board: { pubkey: OWNER, slug: "voxboard" },
        title: mock.title,
        body: mock.body,
        categories: mock.cats,
        createdAt: NOW - mock.ageH * 3600,
      }),
      mock.pk,
      hx(0x10 + index),
    ),
  )!;
  const row: IdeaRow = {
    idea,
    tally: { up: mock.up, down: mock.down, score: mock.up - mock.down, byPubkey: new Map() },
    replyCount: mock.replies,
    pinned: false,
    zapSats: mock.zaps ?? 0,
  };
  if (mock.status) row.status = mock.status;
  return { row, author: mock.author, zaps: mock.zaps ?? 0 };
}

const ENTRIES = MOCKS.map(toRow);

export default function PreviewPage() {
  const [sort, setSort] = useState<SortKey>("top");
  const [category, setCategory] = useState<string | null>(null);

  const rows = ENTRIES.map((e) => e.row);
  const visible = useMemo(() => sortAndFilter(rows, sort, category), [rows, sort, category]);

  return (
    <Shell>
      <BoardHeader
        board={board}
        ideaCount={rows.length}
        attested
        onNewIdea={() => {}}
        onEdit={() => {}}
        onCopyLink={() => navigator.clipboard?.writeText(window.location.href)}
      />
      <FeedToolbar
        sort={sort}
        onSort={setSort}
        categories={board.categories}
        activeCategory={category}
        onCategory={setCategory}
      />
      <div>
        {visible.map((row) => {
          const entry = ENTRIES.find((e) => e.row.idea.id === row.idea.id)!;
          return (
            <FeedRow
              key={row.idea.id}
              row={row}
              author={entry.author}
              zapSats={entry.zaps}
              href="#"
            />
          );
        })}
      </div>
    </Shell>
  );
}
