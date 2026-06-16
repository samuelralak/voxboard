import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Comment01Icon, FlashIcon, PinIcon } from "@hugeicons/core-free-icons";
import type { IdeaRow } from "@/hooks/use-board-data";
import type { Nip05State } from "@/hooks/use-nip05-verify";
import { Avatar } from "@/components/ui/avatar";
import { Chip, InNetworkBadge, VerifiedChip } from "@/components/ui/chip";
import { StatusDot } from "@/components/ui/status-dot";
import { VotePill } from "./vote-pill";
import { cleanName, formatCount, formatSats, fullTime, isoTime, npubShort, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface AuthorInfo {
  name?: string;
  picture?: string;
  nip05?: string;
}

/**
 * One feed entry: the vote ledger on the left, then title (with an inline status dot), a two-line
 * excerpt, and a quiet meta line that reads like a ledger entry — author, time, sats, replies, tags.
 * Presentational: data + author profile come in as props; the container resolves them.
 */
export function FeedRow({
  row,
  author,
  href,
  nip05State = "idle",
  visited = false,
  inNetwork = false,
  zapSats = 0,
  myVote = null,
  scoreDelta = 0,
  onUp,
  onDown,
  votingDisabled = false,
}: {
  row: IdeaRow;
  author?: AuthorInfo;
  href: string;
  nip05State?: Nip05State;
  /** the viewer has already opened this idea: de-emphasize the title */
  visited?: boolean;
  /** the viewer follows this author (Web-of-Trust depth-1) */
  inNetwork?: boolean;
  zapSats?: number;
  myVote?: "up" | "down" | null;
  scoreDelta?: number;
  onUp?: () => void;
  onDown?: () => void;
  votingDisabled?: boolean;
}) {
  const { idea, tally, status, replyCount } = row;
  const name = cleanName(author?.name);
  const authorName = name || npubShort(idea.pubkey);
  const isNpub = name.length === 0;

  return (
    <article className="group flex gap-3 border-b border-border py-4 transition-colors hover:bg-surface-2">
      <VotePill score={tally.score + scoreDelta} myVote={myVote} onUp={onUp} onDown={onDown} disabled={votingDisabled} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {row.pinned || status ? (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              {row.pinned ? (
                <HugeiconsIcon
                  icon={PinIcon}
                  size={13}
                  strokeWidth={2}
                  className="-rotate-45 text-muted"
                  role="img"
                  aria-label="Pinned"
                />
              ) : null}
              {status ? <StatusDot status={status} showLabel tint /> : null}
            </span>
          ) : null}
          <h3
            className={cn(
              "min-w-0 truncate font-display text-base font-semibold tracking-tight",
              visited ? "text-muted" : "text-ink", // already-read ideas recede
            )}
          >
            <Link
              href={href}
              title={idea.title}
              className="rounded-sm transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {idea.title}
            </Link>
          </h3>
        </div>

        {idea.body ? (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{idea.body}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Avatar pubkey={idea.pubkey} src={author?.picture} alt={authorName} size="sm" />
            <span className={isNpub ? "truncate font-mono text-ink" : "truncate font-medium text-ink"}>
              {authorName}
            </span>
            {inNetwork ? <InNetworkBadge /> : null}
          </span>
          {author?.nip05 ? <VerifiedChip nip05={author.nip05} state={nip05State} /> : null}
          <time suppressHydrationWarning dateTime={isoTime(idea.createdAt)} title={fullTime(idea.createdAt)}>{timeAgo(idea.createdAt)}</time>
          {zapSats > 0 ? (
            <span className="inline-flex items-center gap-1 text-zap">
              <HugeiconsIcon icon={FlashIcon} size={13} strokeWidth={2} aria-hidden />
              <span className="font-mono tabular-nums">{formatSats(zapSats)}</span>
            </span>
          ) : null}
          {replyCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <HugeiconsIcon icon={Comment01Icon} size={13} strokeWidth={2} aria-hidden />
              <span className="font-mono tabular-nums">{formatCount(replyCount)}</span>
              <span className="sr-only">replies</span>
            </span>
          ) : null}
          {idea.categories.slice(0, 4).map((category) => (
            <Chip key={category}>{category}</Chip>
          ))}
        </div>
      </div>
    </article>
  );
}
