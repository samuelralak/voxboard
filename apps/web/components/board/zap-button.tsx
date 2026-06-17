"use client";

import { useId, useRef, useState } from "react";
import { ElDialog, ElDialogBackdrop, ElDialogPanel } from "@tailwindplus/elements/react";
import { useNDK } from "@nostr-dev-kit/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, FlashIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useLoginGate } from "@/components/auth/login-gate";
import { useDialogOpenFocus } from "@/hooks/use-dialog-open-focus";
import { ClientOnly } from "@/components/util/client-only";
import { openDialog, closeDialog } from "@/lib/dialog";
import { ZapError, payWithWebLN, requestZapInvoice } from "@/lib/zap/request";
import { cn } from "@/lib/utils";

const PRESETS = [21, 100, 1000, 5000];

type Status = "idle" | "requesting" | "success" | "manual";

function ZapDialog({
  dialogId,
  eventId,
  recipientPubkey,
  lud16,
}: {
  dialogId: string;
  eventId: string;
  recipientPubkey: string;
  lud16: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogOpenFocus(dialogRef);
  const { ndk } = useNDK();
  const [sats, setSats] = useState(21);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [pr, setPr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setSats(21);
    setComment("");
    setStatus("idle");
    setPr(null);
    setError(null);
    setCopied(false);
  };

  const zap = async () => {
    if (!ndk) return;
    setStatus("requesting");
    setError(null);
    try {
      const invoice = await requestZapInvoice(ndk, { eventId, recipientPubkey, lud16 }, sats, comment);
      setPr(invoice.pr);
      const paid = await payWithWebLN(invoice.pr).catch(() => false);
      setStatus(paid ? "success" : "manual");
    } catch (e) {
      setError(e instanceof ZapError ? e.message : "Couldn’t create the zap.");
      setStatus("idle");
    }
  };

  const copyInvoice = async () => {
    if (!pr) return;
    try {
      await navigator.clipboard?.writeText(pr);
      setCopied(true);
    } catch {
      // ignore
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
          <ElDialogPanel className="relative w-full transform overflow-hidden rounded-2xl border border-border bg-surface p-5 text-left shadow-pop transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in motion-reduce:transition-none sm:my-8 sm:max-w-md sm:p-6 data-closed:sm:translate-y-0 data-closed:sm:scale-95">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zap/10 text-zap">
                <HugeiconsIcon icon={FlashIcon} size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <h2 id={`${dialogId}-title`} className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
                  Send a zap
                </h2>
                <p className="mt-1 text-sm text-muted">A Lightning tip, paid by your wallet. Your keys never leave this device.</p>
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

            {status === "success" ? (
              <div className="mt-6 text-center">
                <p className="font-display text-lg text-ink">Zap sent ⚡</p>
                <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted">
                  It’ll appear on the post once your wallet’s payment is confirmed on the relays.
                </p>
                <Button className="mt-4 w-full" onClick={() => closeDialog(dialogId)}>
                  Done
                </Button>
              </div>
            ) : status === "manual" && pr ? (
              <div className="mt-5">
                <p className="text-sm text-muted">
                  Pay this invoice with any Lightning wallet. The zap appears once it’s confirmed.
                </p>
                <div className="mt-3 break-all rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-ink">
                  {pr.slice(0, 64)}…
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={copyInvoice}>
                    <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={2} />
                    {copied ? "Copied" : "Copy invoice"}
                  </Button>
                  <a
                    href={`lightning:${pr}`}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    Open in wallet
                  </a>
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setSats(preset)}
                      aria-pressed={sats === preset}
                      className={cn(
                        "inline-flex h-9 items-center rounded-full border px-3.5 font-mono text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        sats === preset
                          ? "border-zap bg-zap/10 text-zap"
                          : "border-border bg-surface-2 text-muted hover:bg-surface hover:text-ink",
                      )}
                    >
                      {preset.toLocaleString()}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={sats}
                    onChange={(e) => setSats(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                    aria-label="Custom amount in sats"
                    className="h-9 w-24 rounded-full border border-border bg-surface-2 px-3 text-center font-mono text-sm tabular-nums text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  />
                </div>

                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Say something (optional)"
                  maxLength={200}
                  className="mt-3 h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-ink placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />

                {error ? (
                  <p role="alert" className="mt-3 text-xs text-status-declined">
                    {error}
                  </p>
                ) : null}

                <Button className="mt-4 w-full" disabled={status === "requesting"} aria-busy={status === "requesting"} onClick={zap}>
                  {status === "requesting" ? "Preparing…" : `Zap ${sats.toLocaleString()} sats`}
                </Button>
              </div>
            )}
          </ElDialogPanel>
        </div>
      </dialog>
    </ElDialog>
  );
}

/**
 * ⚡ Zap action on an idea. Always shown on the detail page so zapping is discoverable; when the author
 * has no Lightning address (lud16), it renders disabled with an explanation instead of disappearing.
 */
export function ZapButton({
  eventId,
  recipientPubkey,
  lud16,
}: {
  eventId: string;
  recipientPubkey: string;
  lud16?: string;
}) {
  const dialogId = useId();
  const { requireLogin } = useLoginGate();

  if (!lud16) {
    // The span carries the tooltip (a disabled <button> doesn't reliably show its own title).
    return (
      <span title="This author hasn’t set up Lightning zaps." className="inline-flex">
        <Button variant="ghost" size="sm" disabled aria-label="Zaps unavailable: this author has no Lightning address">
          <HugeiconsIcon icon={FlashIcon} size={14} strokeWidth={2} />
          Zap
        </Button>
      </span>
    );
  }

  return (
    <>
      {/* The one value action on a feedback idea, so it leads: a quiet zap-tinted outline (the sanctioned
          zap hue, same as the amount presets) rather than another grey ghost. Copy link + Delete stay
          ghost, so the eye lands on Zap first. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => requireLogin(() => openDialog(dialogId))}
        className="border-zap/30 text-zap hover:border-zap/50 hover:bg-zap/10 hover:text-zap"
      >
        <HugeiconsIcon icon={FlashIcon} size={14} strokeWidth={2} />
        Zap
      </Button>
      <ClientOnly>
        <ZapDialog dialogId={dialogId} eventId={eventId} recipientPubkey={recipientPubkey} lud16={lud16} />
      </ClientOnly>
    </>
  );
}
