"use client";

import { useCallback } from "react";
import { useNDK } from "@nostr-dev-kit/react";
import { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk";
import type { EventTemplate } from "@voxboard/protocol";

/**
 * Sign and publish an EventTemplate (produced by the @voxboard/protocol builders) through the active
 * signer and the outbox relays. Returns the signed NDKEvent (its `.id` is the published event id).
 * Throws if not connected or not logged in. Signing is client-side; the key never leaves the browser.
 */
export function usePublish() {
  const { ndk } = useNDK();

  return useCallback(
    async (template: EventTemplate): Promise<NDKEvent> => {
      if (!ndk) throw new Error("Not connected to relays yet.");
      if (!ndk.signer) throw new Error("Log in to publish.");

      const event = new NDKEvent(ndk, {
        kind: template.kind as NDKKind,
        created_at: template.created_at,
        tags: template.tags,
        content: template.content,
      });
      await event.sign();
      await event.publish();
      return event;
    },
    [ndk],
  );
}
