"use client";

import { useCallback, useMemo } from "react";
import {
  buildApproval,
  buildBan,
  buildHide,
  buildLock,
  buildPin,
  buildStatus,
  buildUnpin,
  isAuthorized,
  type Board,
  type CommunityRef,
  type NostrEvent,
  type Status,
} from "@voxboard/protocol";
import { usePublish } from "./use-publish";
import { useAuth } from "./use-auth";

export interface Moderation {
  /** the signed-in user is the board owner or a moderator */
  canModerate: boolean;
  setStatus: (ideaId: string, state: Status) => Promise<void>;
  pin: (ideaId: string) => Promise<void>;
  unpin: (ideaId: string) => Promise<void>;
  lock: (ideaId: string) => Promise<void>;
  /** hide an idea OR a reply by event id */
  hide: (targetId: string) => Promise<void>;
  ban: (pubkey: string) => Promise<void>;
  /** approve a post on a curated board (NIP-72 kind 4550); pass the full idea event */
  approve: (post: NostrEvent) => Promise<void>;
}

/**
 * Owner/moderator actions: each publishes a NIP-32 label (status/pin/lock/hide) or a ban, scoped to the
 * board. Authority is read-time-resolved (the label only "counts" if the author is the owner/a mod),
 * so the gate here is UX only; the read path (deriveBoardStats / useBoardData) is the real enforcer.
 */
export function useModeration(board: Board | null | undefined): Moderation {
  const publish = usePublish();
  const { pubkey } = useAuth();

  const canModerate = Boolean(board && pubkey && isAuthorized(pubkey, board));
  const ref: CommunityRef | undefined = board?.ref;
  const relay = board?.relays[0]?.url;

  const setStatus = useCallback(
    async (ideaId: string, state: Status) => {
      if (!ref) return;
      await publish(buildStatus(relay ? { target: { id: ideaId }, board: ref, state, boardRelay: relay } : { target: { id: ideaId }, board: ref, state }));
    },
    [ref, relay, publish],
  );

  const labelAction = useCallback(
    (build: typeof buildPin) => async (ideaId: string) => {
      if (!ref) return;
      await publish(build(relay ? { target: { id: ideaId }, board: ref, boardRelay: relay } : { target: { id: ideaId }, board: ref }));
    },
    [ref, relay, publish],
  );

  const pin = useMemo(() => labelAction(buildPin), [labelAction]);
  const unpin = useMemo(() => labelAction(buildUnpin), [labelAction]);
  const lock = useMemo(() => labelAction(buildLock), [labelAction]);
  const hide = useMemo(() => labelAction(buildHide), [labelAction]);

  const ban = useCallback(
    async (subject: string) => {
      if (!ref) return;
      await publish(buildBan(relay ? { subject, board: ref, boardRelay: relay } : { subject, board: ref }));
    },
    [ref, relay, publish],
  );

  const approve = useCallback(
    async (post: NostrEvent) => {
      if (!ref) return;
      await publish(buildApproval(relay ? { board: ref, post, boardRelay: relay } : { board: ref, post }));
    },
    [ref, relay, publish],
  );

  return useMemo(
    () => ({ canModerate, setStatus, pin, unpin, lock, hide, ban, approve }),
    [canModerate, setStatus, pin, unpin, lock, hide, ban, approve],
  );
}
