"use client";

import { useCallback } from "react";
import { buildDelete } from "@voxboard/protocol";
import { usePublish } from "./use-publish";

/**
 * Retract one of your own events (NIP-09 kind 5). Relays validate that the referenced event shares the
 * deleter's pubkey, so this only works on your own ideas, replies, and reactions. Honoring is advisory,
 * so callers also hide the target locally (optimistically) until the read path reflects the deletion.
 */
export function useDelete() {
  const publish = usePublish();
  return useCallback(
    async (id: string, kind: number, coordinate?: string) => {
      // `scope` (the board coordinate) adds an `A` tag so the board's coordinate-keyed deletions
      // subscription catches the retraction live (Phase 9). buildDelete drops it when undefined.
      await publish(buildDelete({ ids: [id], kinds: [kind], scope: coordinate }));
    },
    [publish],
  );
}
