"use client";

import { useProfileValue } from "@nostr-dev-kit/react";
import { KIND, type VoteTarget } from "@voxboard/protocol";
import type { IdeaRow } from "@/hooks/use-board-data";
import type { Voting } from "@/hooks/use-voting";
import { useNip05Verify } from "@/hooks/use-nip05-verify";
import { useVisited } from "@/hooks/use-visited";
import { useWebOfTrust } from "@/hooks/use-web-of-trust";
import { FeedRow, type AuthorInfo } from "./feed-row";

/** Resolves the idea author's profile (kind 0) and renders the presentational FeedRow, wired to vote. */
export function FeedRowContainer({ row, href, voting }: { row: IdeaRow; href: string; voting: Voting }) {
  const profile = useProfileValue(row.idea.pubkey);

  const author: AuthorInfo = {};
  const name = profile?.displayName ?? profile?.name;
  if (name) author.name = name;
  if (profile?.picture) author.picture = profile.picture;
  if (profile?.nip05) author.nip05 = profile.nip05;

  const nip05State = useNip05Verify(profile?.nip05, row.idea.pubkey);
  const visited = useVisited().has(row.idea.id);
  const inNetwork = useWebOfTrust().isTrusted(row.idea.pubkey);

  const id = row.idea.id;
  const target: VoteTarget = { id, pubkey: row.idea.pubkey, kind: KIND.Comment };

  return (
    <FeedRow
      row={row}
      author={author}
      href={href}
      nip05State={nip05State}
      visited={visited}
      inNetwork={inNetwork}
      zapSats={row.zapSats}
      myVote={voting.myVote(id)}
      scoreDelta={voting.scoreDelta(id)}
      onUp={() => voting.cast(target, "up")}
      onDown={() => voting.cast(target, "down")}
      votingDisabled={voting.isPending(id)}
    />
  );
}
