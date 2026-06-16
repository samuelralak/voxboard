"use client";

import { useRef, useState } from "react";
import { ElDialog, ElDialogBackdrop, ElDialogPanel } from "@tailwindplus/elements/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  GlobalIcon,
  Key01Icon,
  Shield01Icon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useDialogOpenFocus } from "@/hooks/use-dialog-open-focus";

type Method = "extension" | "bunker" | "nsec";

const inputClass =
  "h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 font-mono text-xs text-ink placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";
const badgeClass = "grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent";

/**
 * Login modal: Tailwind Plus Elements (ElDialog) canonical markup + the card-based auth pattern (an
 * icon-badge header, one card per signer with icon + title + description, a chevron on the recommended
 * extension card, and the riskiest nsec path tucked inside a collapsible <details>). Opened via
 * `command="show-modal" commandfor={dialogId}`; closed via the dialog ref / `command="close"`.
 *
 * The component is mounted for the whole logged-out session and never unmounts, so close (via the X,
 * Escape, backdrop, or a successful login) must actively reset state: handleClose wipes the typed nsec
 * and bunker values (the nsec is a raw private key, so it must not survive an abandoned interaction),
 * clears any in-flight pending/error, and collapses the nsec disclosure.
 */
export function LoginDialog({
  dialogId,
  onAuthenticated,
}: {
  dialogId: string;
  /** fired once a sign-in through this dialog succeeds, so the gate can resume a deferred action */
  onAuthenticated?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDialogOpenFocus(dialogRef);
  const { hasExtension, error, clearError, loginExtension, loginNsec, loginBunker } = useAuth();
  const [nsec, setNsec] = useState("");
  const [bunker, setBunker] = useState("");
  const [pending, setPending] = useState<Method | null>(null);
  const [errorMethod, setErrorMethod] = useState<Method | null>(null);

  const run = async (method: Method, fn: () => Promise<void>) => {
    setPending(method);
    setErrorMethod(null);
    try {
      await fn();
      dialogRef.current?.close();
      onAuthenticated?.();
    } catch {
      // error surfaced via useAuth().error; remember which method it belongs to so we only mark
      // that method's field invalid (an extension failure must not invalidate the nsec/bunker inputs).
      setErrorMethod(method);
    } finally {
      setPending(null);
    }
  };

  // The dialog never unmounts; the native close event fires for every dismissal path (X / Esc /
  // backdrop / programmatic close on success), so reset all transient + sensitive state here.
  const handleClose = () => {
    clearError();
    setPending(null);
    setErrorMethod(null);
    setNsec("");
    setBunker("");
    if (detailsRef.current) detailsRef.current.open = false;
  };

  const errorId = `${dialogId}-error`;
  const onFieldChange = () => {
    if (error) clearError();
  };
  const busy = pending !== null;
  const bunkerInvalid = Boolean(error) && errorMethod === "bunker";
  const nsecInvalid = Boolean(error) && errorMethod === "nsec";

  return (
    <ElDialog>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={`${dialogId}-title`}
        onClose={handleClose}
        className="fixed inset-0 size-auto max-h-none max-w-none overflow-y-auto bg-transparent backdrop:bg-transparent"
      >
        <ElDialogBackdrop className="fixed inset-0 bg-ink/45 backdrop-blur-sm transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in motion-reduce:transition-none" />

        <div className="flex min-h-full items-end justify-center p-4 focus:outline-none sm:items-center sm:p-0" tabIndex={0}>
          <ElDialogPanel className="relative w-full transform overflow-hidden rounded-2xl border border-border bg-canvas p-5 text-left shadow-pop transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in motion-reduce:transition-none sm:my-8 sm:max-w-md sm:p-6 data-closed:sm:translate-y-0 data-closed:sm:scale-95">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground shadow-card">
                <HugeiconsIcon icon={Key01Icon} size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <h2 id={`${dialogId}-title`} className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
                  Your keys, your voice
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Sign in with your Nostr key to post ideas and vote. Your key never reaches our server.
                </p>
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

            <div className="mt-5 space-y-3">
              {hasExtension ? (
                <button
                  type="button"
                  autoFocus
                  data-autofocus=""
                  onClick={() => run("extension", loginExtension)}
                  disabled={busy}
                  aria-busy={pending === "extension"}
                  className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3.5 text-left shadow-card transition-colors hover:border-accent/40 hover:bg-accent/5 active:translate-y-px disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className={badgeClass}>
                    <HugeiconsIcon icon={Shield01Icon} size={18} strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">Browser extension</span>
                    <span className="block text-xs text-muted">
                      {pending === "extension" ? "Connecting…" : "Alby, nos2x: the key stays in the extension"}
                    </span>
                  </span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={16}
                    strokeWidth={2}
                    className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              ) : null}

              <div className="rounded-xl border border-border bg-surface p-3.5">
                <div className="flex items-center gap-3">
                  <span className={badgeClass}>
                    <HugeiconsIcon icon={GlobalIcon} size={18} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">Remote signer</p>
                    <p className="text-xs text-muted">Paste a bunker:// URL (NIP-46); the key stays on your signer</p>
                  </div>
                </div>
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("bunker", () => loginBunker(bunker));
                  }}
                >
                  <label htmlFor={`${dialogId}-bunker`} className="sr-only">
                    Bunker URL
                  </label>
                  <input
                    id={`${dialogId}-bunker`}
                    value={bunker}
                    onChange={(e) => {
                      setBunker(e.target.value);
                      onFieldChange();
                    }}
                    placeholder="bunker://…"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus={!hasExtension}
                    data-autofocus={!hasExtension ? "" : undefined}
                    aria-invalid={bunkerInvalid}
                    aria-describedby={bunkerInvalid ? errorId : undefined}
                    className={inputClass}
                  />
                  <Button type="submit" disabled={busy || bunker.trim().length === 0} aria-busy={pending === "bunker"} className="shrink-0 rounded-lg">
                    Connect
                  </Button>
                </form>
                {pending === "bunker" ? (
                  <p className="mt-2 text-xs text-muted">Approve the request in your signer app.</p>
                ) : null}
              </div>

              <details ref={detailsRef} className="group rounded-xl border border-border bg-surface p-3.5">
                <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                  <span className={badgeClass}>
                    <HugeiconsIcon icon={SquareLock01Icon} size={18} strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">Paste an nsec</span>
                    <span className="block text-xs text-muted">Least safe: your key enters this page</span>
                  </span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={16}
                    strokeWidth={2}
                    className="shrink-0 text-muted transition-transform group-open:rotate-90"
                  />
                </summary>
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("nsec", () => loginNsec(nsec));
                  }}
                >
                  <label htmlFor={`${dialogId}-nsec`} className="sr-only">
                    Private key (nsec)
                  </label>
                  <input
                    id={`${dialogId}-nsec`}
                    type="password"
                    value={nsec}
                    onChange={(e) => {
                      setNsec(e.target.value);
                      onFieldChange();
                    }}
                    placeholder="nsec1…"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore="true"
                    data-lpignore="true"
                    aria-invalid={nsecInvalid}
                    aria-describedby={nsecInvalid ? errorId : undefined}
                    className={inputClass}
                  />
                  <Button type="submit" disabled={busy || nsec.trim().length === 0} aria-busy={pending === "nsec"} className="shrink-0 rounded-lg">
                    Sign in
                  </Button>
                </form>
              </details>
            </div>

            <p id={errorId} role="alert" aria-live="assertive" className="mt-4 min-h-5 text-xs text-status-declined">
              {error}
            </p>
          </ElDialogPanel>
        </div>
      </dialog>
    </ElDialog>
  );
}
