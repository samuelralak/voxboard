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
    async (id: string, kind: number) => {
      await publish(buildDelete({ ids: [id], kinds: [kind] }));
    },
    [publish],
  );
}
