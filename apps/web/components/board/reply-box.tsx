"use client";

import { useState } from "react";
import {
  buildReply,
  type BuildReplyInput,
  type CommunityRef,
  type NostrEvent,
  type ParentRef,
} from "@voxboard/protocol";
import { Button } from "@/components/ui/button";
import { usePublish } from "@/hooks/use-publish";
import { toNostrEvent } from "@/lib/nostr/event";

/**
 * Compose a reply (NIP-22 kind 1111) to an idea or another reply. `parent` carries the immediate
 * parent's id/pubkey/kind so the reply threads correctly; the root scope stays the board. The live `#A`
 * subscription only echoes a published reply back if it is open and matching at publish time, so the
 * signed reply is also handed up via `onReplied` for an immediate optimistic insert into the tree.
 *
 * Takes the community `ref` directly (not the full Board) so the form can never be hidden just because
 * the kind-34550 board object hasn't resolved on the idea page; the ref is always on the idea/reply.
 */
export function ReplyBox({
  boardRef,
  boardRelay,
  parent,
  onDone,
  onReplied,
  autoFocus = false,
  placeholder = "Add a reply",
}: {
  boardRef: CommunityRef;
  boardRelay?: string;
  parent: ParentRef;
  onDone?: () => void;
  onReplied?: (event: NostrEvent) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const publish = usePublish();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = body.trim().length > 0 && !pending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setPending(true);
    setError(null);
    try {
      const input: BuildReplyInput = { board: boardRef, parent, body: body.trim() };
      if (boardRelay) input.boardRelay = boardRelay;
      const published = await publish(buildReply(input));
      const mapped = toNostrEvent(published);
      if (mapped) onReplied?.(mapped);
      setBody("");
      onDone?.();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not post your reply. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        aria-label={placeholder}
        className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
      {error ? (
        <p role="alert" aria-live="assertive" className="mt-1.5 text-xs text-status-declined">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onDone ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={!canSend} aria-busy={pending}>
          {pending ? "Posting…" : "Reply"}
        </Button>
      </div>
    </form>
  );
}
