"use client";

import { useRef, useState } from "react";
import { ElDialog, ElDialogBackdrop, ElDialogPanel } from "@tailwindplus/elements/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { buildIdea, type Board, type BuildIdeaInput } from "@voxboard/protocol";
import { Button } from "@/components/ui/button";
import { usePublish } from "@/hooks/use-publish";
import { useDialogOpenFocus } from "@/hooks/use-dialog-open-focus";
import { closeDialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";

/**
 * Compose a new idea (NIP-22 kind 1111 rooted at the board). Same Tailwind Plus Elements dialog shell
 * as the login modal. On a successful publish NDK echoes the event into the board's live `#A`
 * subscription, so the feed updates on its own; we just close and reset. Opened via openDialog() from
 * the gated "New idea" button.
 */
export function ComposeIdeaDialog({ dialogId, board }: { dialogId: string; board: Board }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogOpenFocus(dialogRef);
  const publish = usePublish();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setBody("");
    setCategories([]);
    setError(null);
    setPending(false);
  };

  const toggleCategory = (category: string) => {
    setCategories((current) =>
      current.includes(category) ? current.filter((c) => c !== category) : [...current, category],
    );
  };

  const canPost = title.trim().length > 0 && !pending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canPost) return;
    setPending(true);
    setError(null);
    try {
      const input: BuildIdeaInput = { board: board.ref, title: title.trim(), categories };
      const relay = board.relays[0]?.url;
      if (relay) input.boardRelay = relay;
      const text = body.trim();
      if (text) input.body = text;
      await publish(buildIdea(input));
      dialogRef.current?.close(); // fires onClose -> reset
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not post your idea. Try again.");
    } finally {
      setPending(false);
    }
  };

  const errorId = `${dialogId}-error`;

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
                <HugeiconsIcon icon={PlusSignIcon} size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <h2 id={`${dialogId}-title`} className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
                  Share an idea
                </h2>
                <p className="mt-1 truncate text-sm text-muted">Posting to {board.name}</p>
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
                <label htmlFor={`${dialogId}-title-input`} className="mb-1.5 block text-sm font-medium text-ink">
                  Title
                </label>
                <input
                  id={`${dialogId}-title-input`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A short, clear summary"
                  maxLength={140}
                  autoFocus
                  data-autofocus=""
                  required
                  aria-describedby={error ? errorId : undefined}
                  className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-ink placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label htmlFor={`${dialogId}-body-input`} className="mb-1.5 block text-sm font-medium text-ink">
                  Details <span className="font-normal text-muted">(optional)</span>
                </label>
                <textarea
                  id={`${dialogId}-body-input`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Add context, the problem it solves, or examples."
                  rows={4}
                  className="w-full resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </div>

              {board.categories.length > 0 ? (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink">Categories</legend>
                  <div className="flex flex-wrap gap-2">
                    {board.categories.map((category) => {
                      const active = categories.includes(category);
                      return (
                        <button
                          key={category}
                          type="button"
                          onClick={() => toggleCategory(category)}
                          aria-pressed={active}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            active
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border bg-surface-2 text-muted hover:bg-surface hover:text-ink",
                          )}
                        >
                          {category}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <p id={errorId} role="alert" aria-live="assertive" className="min-h-5 text-xs text-status-declined">
                {error}
              </p>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="md" onClick={() => closeDialog(dialogId)}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={!canPost} aria-busy={pending}>
                  {pending ? "Posting…" : "Post idea"}
                </Button>
              </div>
            </form>
          </ElDialogPanel>
        </div>
      </dialog>
    </ElDialog>
  );
}
