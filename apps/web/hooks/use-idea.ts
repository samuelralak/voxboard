"use client";

import { useMemo } from "react";
import { useEvent } from "@nostr-dev-kit/react";
import { parseIdea, type Idea } from "@voxboard/protocol";
import { ndkFilter, toNostrEvent } from "@/lib/nostr/event";

/** Resolve a single idea (kind 1111) by event id. `undefined` while loading, `null` if not found. */
export function useIdea(ideaId: string | null): Idea | null | undefined {
  const event = useEvent(ideaId ? ndkFilter({ ids: [ideaId] }) : false, undefined, [ideaId]);
  return useMemo(() => {
    if (event === undefined) return undefined;
    if (event === null) return null;
    const mapped = toNostrEvent(event);
    return mapped ? parseIdea(mapped) : null;
  }, [event]);
}
