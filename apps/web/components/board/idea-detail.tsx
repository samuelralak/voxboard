import { HugeiconsIcon } from "@hugeicons/react";
import { Comment01Icon, Copy01Icon, FlashIcon, UserCheck01Icon } from "@hugeicons/core-free-icons";
import type { Idea, Status, VoteTally } from "@voxboard/protocol";
import { isHttpUrl } from "@voxboard/protocol";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip, InNetworkBadge, VerifiedChip } from "@/components/ui/chip";
import { StatusDot } from "@/components/ui/status-dot";
import { VotePill } from "./vote-pill";
import { DeleteButton } from "./delete-button";
import { ModerationMenu } from "./moderation-menu";
import { ZapButton } from "./zap-button";
import type { Moderation } from "@/hooks/use-moderation";
import type { Nip05State } from "@/hooks/use-nip05-verify";
import type { AuthorInfo } from "./feed-row";
import { cleanName, formatCount, formatSats, fullTime, isoTime, npubShort, timeAgo } from "@/lib/format";

/** The idea at the top of its detail page: vote ledger, title, status, author, body, images, tags. */
export function IdeaDetail({
  idea,
  author,
  tally,
  replyCount,
  status,
  nip05State = "idle",
  inNetwork = false,
  trustedUpvotes = 0,
  zapSats = 0,
  onCopyLink,
  myVote = null,
  scoreDelta = 0,
  onUp,
  onDown,
  votingDisabled = false,
  canDelete = false,
  onDelete,
  moderation,
  pinned = false,
  authorLud16,
}: {
  idea: Idea;
  author?: AuthorInfo;
  tally: VoteTally;
  replyCount: number;
  status?: Status;
  nip05State?: Nip05State;
  /** the viewer follows this author (Web-of-Trust depth-1) */
  inNetwork?: boolean;
  /** upvotes on this idea from accounts the viewer follows */
  trustedUpvotes?: number;
  /** the author's lightning address; enables the zap action when present */
  authorLud16?: string;
  zapSats?: number;
  onCopyLink?: () => void;
  myVote?: "up" | "down" | null;
  scoreDelta?: number;
  onUp?: () => void;
  onDown?: () => void;
  votingDisabled?: boolean;
  canDelete?: boolean;
  onDelete?: () => Promise<void> | void;
  moderation?: Moderation;
  pinned?: boolean;
}) {
  const name = cleanName(author?.name);
  const authorName = name || npubShort(idea.pubkey);
  const isNpub = name.length === 0;

  return (
    <article className="flex gap-3 py-6">
      <VotePill
        score={tally.score + scoreDelta}
        myVote={myVote}
        onUp={onUp}
        onDown={onDown}
        disabled={votingDisabled}
      />

      <div className="min-w-0 flex-1">
        {status ? (
          <div className="mb-2">
            <StatusDot status={status} showLabel tint />
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
            {idea.title}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <ZapButton eventId={idea.id} recipientPubkey={idea.pubkey} lud16={authorLud16} />
            {moderation?.canModerate ? (
              <ModerationMenu
                moderation={moderation}
                ideaId={idea.id}
                authorPubkey={idea.pubkey}
                pinned={pinned}
                {...(status ? { status } : {})}
              />
            ) : null}
            <Button variant="ghost" size="sm" onClick={onCopyLink}>
              <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={2} />
              Copy link
            </Button>
            {canDelete && onDelete ? <DeleteButton onConfirm={onDelete} /> : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Avatar pubkey={idea.pubkey} src={author?.picture} alt={authorName} size="sm" />
            <span className={isNpub ? "truncate font-mono text-ink" : "truncate font-medium text-ink"}>
              {authorName}
            </span>
            {inNetwork ? <InNetworkBadge /> : null}
          </span>
          {author?.nip05 ? <VerifiedChip nip05={author.nip05} state={nip05State} /> : null}
          {trustedUpvotes > 0 ? (
            <span className="inline-flex items-center gap-1" title="Upvotes from accounts you follow">
              <HugeiconsIcon icon={UserCheck01Icon} size={13} strokeWidth={2} aria-hidden />
              <span className="font-mono tabular-nums">{trustedUpvotes}</span>
              <span className="sr-only">upvotes from your network</span>
            </span>
          ) : null}
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
        </div>

        {idea.body ? (
          <div className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed text-ink">
            {idea.body}
          </div>
        ) : null}

        {idea.images.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {/* Re-check the scheme at the sink (parseImeta already filters, but keep the trust boundary
                local, mirroring avatar.tsx) so a non-http(s) url can never reach an <img src> beacon. */}
            {idea.images.filter((image) => isHttpUrl(image.url)).map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.url}
                src={image.url}
                alt={image.alt ?? ""}
                loading="lazy"
                className="max-h-96 w-full rounded-md border border-border object-cover"
              />
            ))}
          </div>
        ) : null}

        {idea.categories.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {idea.categories.map((category) => (
              <Chip key={category}>{category}</Chip>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
