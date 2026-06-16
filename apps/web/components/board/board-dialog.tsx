"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as nip19 from "nostr-tools/nip19";
import { ElDialog, ElDialogBackdrop, ElDialogPanel } from "@tailwindplus/elements/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import {
  MODERATION_MODE,
  boardNaddr,
  buildBoard,
  type Board,
  type BoardModerator,
  type BuildBoardInput,
  type ModerationMode,
} from "@voxboard/protocol";
import { Button } from "@/components/ui/button";
import { usePublish } from "@/hooks/use-publish";
import { useAuth } from "@/hooks/use-auth";
import { useDialogOpenFocus } from "@/hooks/use-dialog-open-focus";
import { closeDialog } from "@/lib/dialog";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";

const fieldClass =
  "w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-ink placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";
const labelClass = "mb-1.5 block text-sm font-medium text-ink";

function splitCsv(text: string): string[] {
  return [...new Set(text.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** True if a single token is a recognizable key (64-hex, npub, or nprofile). */
function isModeratorToken(token: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(token)) return true;
  try {
    const decoded = nip19.decode(token);
    return decoded.type === "npub" || decoded.type === "nprofile";
  } catch {
    return false;
  }
}

/** Parse a whitespace/comma list of npub / nprofile / hex into deduped moderator pubkeys. */
function parseModerators(text: string): BoardModerator[] {
  const out: BoardModerator[] = [];
  const seen = new Set<string>();
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    let pubkey: string | null = null;
    if (/^[0-9a-fA-F]{64}$/.test(token)) {
      pubkey = token.toLowerCase();
    } else {
      try {
        const decoded = nip19.decode(token);
        if (decoded.type === "npub") pubkey = decoded.data;
        else if (decoded.type === "nprofile") pubkey = decoded.data.pubkey;
      } catch {
        // not a recognizable key; skip
      }
    }
    if (pubkey && !seen.has(pubkey)) {
      seen.add(pubkey);
      out.push({ pubkey });
    }
  }
  return out;
}

function moderatorsToText(mods: BoardModerator[]): string {
  return mods
    .map((m) => {
      try {
        return nip19.npubEncode(m.pubkey);
      } catch {
        return m.pubkey;
      }
    })
    .join(", ");
}

/**
 * Create or edit a board (NIP-72 kind 34550, replaceable). On create, a fresh `d` slug is minted and we
 * navigate to the new board; on edit, the existing slug is reused so the same coordinate is replaced.
 * The board advertises the app's relays so its naddr resolves for everyone.
 */
export function BoardDialog({ dialogId, board }: { dialogId: string; board?: Board }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogOpenFocus(dialogRef);
  const { pubkey } = useAuth();
  const publish = usePublish();
  const router = useRouter();
  const isEdit = Boolean(board);

  const [name, setName] = useState(board?.name ?? "");
  const [description, setDescription] = useState(board?.description ?? "");
  const [categories, setCategories] = useState(board?.categories.join(", ") ?? "");
  const [mode, setMode] = useState<ModerationMode>(board?.mode ?? MODERATION_MODE.open);
  const [moderators, setModerators] = useState(board ? moderatorsToText(board.moderators) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogIsOpen = () => {
    const el = typeof document !== "undefined" ? document.getElementById(dialogId) : null;
    return el instanceof HTMLDialogElement && el.open;
  };

  // Re-seed the edit form from the CURRENT board (e.g. after a concurrent update), so a reopened dialog
  // never republishes a stale snapshot. Guarded so it only runs while the dialog is closed.
  const seedFromBoard = useCallback(() => {
    if (!board) return;
    setName(board.name);
    setDescription(board.description ?? "");
    setCategories(board.categories.join(", "));
    setMode(board.mode);
    setModerators(moderatorsToText(board.moderators));
    setError(null);
    setPending(false);
  }, [board]);

  useEffect(() => {
    if (!isEdit || dialogIsOpen()) return; // don't clobber an in-progress edit
    seedFromBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, isEdit, seedFromBoard]);

  // onClose handler: a create dialog clears; an edit dialog reverts unsaved changes to the live board.
  const reset = () => {
    if (isEdit) {
      seedFromBoard();
      return;
    }
    setName("");
    setDescription("");
    setCategories("");
    setMode(MODERATION_MODE.open);
    setModerators("");
    setError(null);
    setPending(false);
  };

  const canSave = name.trim().length > 0 && !pending;
  const errorId = `${dialogId}-error`;

  // Validation feedback for the moderators field: a security-authority list should not silently drop
  // tokens it cannot parse. Count the recognized keys and flag the rest.
  const modTokens = moderators.split(/[\s,]+/).filter(Boolean);
  const invalidMods = modTokens.filter((t) => !isModeratorToken(t));
  const validModCount = modTokens.length - invalidMods.length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || !pubkey) return;
    setPending(true);
    setError(null);
    try {
      const slug = board?.slug ?? crypto.randomUUID();
      const input: BuildBoardInput = {
        slug,
        name: name.trim(),
        categories: splitCsv(categories),
        moderators: parseModerators(moderators),
        relays: DEFAULT_RELAYS.map((url) => ({ url })),
        mode,
      };
      const text = description.trim();
      if (text) input.description = text;
      await publish(buildBoard(input));
      // compute the naddr before closing (close() resets the create form state)
      const naddr = boardNaddr({ pubkey, slug }, [...DEFAULT_RELAYS]);
      dialogRef.current?.close();
      if (!isEdit) router.push(`/b/${naddr}`);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not save the board. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <ElDialog>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={`${dialogId}-title`}
        onClose={reset}
        className="fixed inset-0 size-auto max-h-none max-w-none overflow-y-auto bg-transparent backdrop:bg-transparent"
      >
        <ElDialogBackdrop className="fixed inset-0 bg-ink/45 backdrop-blur-sm transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in motion-reduce:transition-none" />

        <div className="flex min-h-full items-end justify-center p-4 focus:outline-none sm:items-center sm:p-0" tabIndex={0}>
          <ElDialogPanel className="relative w-full transform overflow-hidden rounded-2xl border border-border bg-surface p-5 text-left shadow-pop transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in motion-reduce:transition-none sm:my-8 sm:max-w-lg sm:p-6 data-closed:sm:translate-y-0 data-closed:sm:scale-95">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground shadow-card">
                <HugeiconsIcon icon={UserGroupIcon} size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <h2 id={`${dialogId}-title`} className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
                  {isEdit ? "Edit board" : "Create a board"}
                </h2>
                <p className="mt-1 text-sm text-muted">A feedback board your community can post ideas to and vote on.</p>
              </div>
              <button
                type="button"
                command="close"
                commandfor={dialogId}
                aria-label="Close"
                className="-mr-1 -mt-1 ml-auto grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
              </button>
            </div>

            <form className="mt-5 space-y-4" onSubmit={submit}>
              <div>
                <label htmlFor={`${dialogId}-name`} className={labelClass}>
                  Name
                </label>
                <input
                  id={`${dialogId}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Feedback"
                  maxLength={120}
                  autoFocus
                  data-autofocus=""
                  required
                  aria-describedby={error ? errorId : undefined}
                  className={`${fieldClass} h-10`}
                />
              </div>

              <div>
                <label htmlFor={`${dialogId}-desc`} className={labelClass}>
                  Description <span className="font-normal text-muted">(optional)</span>
                </label>
                <textarea
                  id={`${dialogId}-desc`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this board is for."
                  rows={2}
                  className={`${fieldClass} resize-y py-2 leading-relaxed`}
                />
              </div>

              <div>
                <label htmlFor={`${dialogId}-cats`} className={labelClass}>
                  Categories <span className="font-normal text-muted">(comma separated)</span>
                </label>
                <input
                  id={`${dialogId}-cats`}
                  value={categories}
                  onChange={(e) => setCategories(e.target.value)}
                  placeholder="feature, bug, idea"
                  className={`${fieldClass} h-10`}
                />
              </div>

              <fieldset>
                <legend className={labelClass}>Posting</legend>
                <div className="flex gap-2">
                  {([MODERATION_MODE.open, MODERATION_MODE.curated] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      className={
                        "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                        (mode === m ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:bg-surface-2 hover:text-ink")
                      }
                    >
                      <span className="block font-medium text-ink">{m === MODERATION_MODE.open ? "Open" : "Curated"}</span>
                      <span className="block text-xs text-muted">
                        {m === MODERATION_MODE.open ? "Anyone can post" : "Posts appear after a mod approves"}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <details className="group rounded-lg border border-border bg-surface-2/40 px-3 py-2">
                <summary className="cursor-pointer list-none text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                  Moderators <span className="font-normal text-muted">(optional)</span>
                </summary>
                <textarea
                  value={moderators}
                  onChange={(e) => setModerators(e.target.value)}
                  placeholder="npub1… npub1…"
                  rows={2}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={`${fieldClass} mt-2 resize-y py-2 font-mono text-xs`}
                />
                {modTokens.length > 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-mono tabular-nums text-ink">{validModCount}</span> recognized
                    {invalidMods.length > 0 ? (
                      <>
                        {", "}
                        <span className="text-status-declined">{invalidMods.length} unrecognized</span> (must be
                        npub, nprofile, or 64-char hex)
                      </>
                    ) : null}
                    .
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">npubs who can set status, pin, hide, and ban on this board.</p>
                )}
              </details>

              <p id={errorId} role="alert" aria-live="assertive" className="min-h-5 text-xs text-status-declined">
                {error}
              </p>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="md" onClick={() => closeDialog(dialogId)}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={!canSave} aria-busy={pending}>
                  {pending ? "Saving…" : isEdit ? "Save changes" : "Create board"}
                </Button>
              </div>
            </form>
          </ElDialogPanel>
        </div>
      </dialog>
    </ElDialog>
  );
}
