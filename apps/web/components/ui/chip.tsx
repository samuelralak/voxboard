import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, CheckmarkBadge01Icon, UserCheck01Icon } from "@hugeicons/core-free-icons";
import type { Nip05State } from "@/hooks/use-nip05-verify";
import { cn } from "@/lib/utils";

/** A small category tag drawn from the board's tag list. One device (a quiet fill, no border), capped
 *  in width so a single long unbroken token truncates instead of stretching the meta line. */
export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block max-w-32 truncate rounded-full bg-surface-2 px-2 py-0.5 align-middle text-xs text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * NIP-05 handle. The badge is earned ONLY by `state === "verified"` — a real round-trip to the domain's
 * .well-known/nostr.json that maps the handle to this exact pubkey. A merely-claimed handle (idle /
 * verifying / network error) shows with no badge; a `mismatch` (the domain maps it to someone else)
 * shows a quiet alert glyph. Stays muted (no accent, no alarming red) per the single-accent rule; the
 * meaning lives in the glyph + the hover title.
 */
export function VerifiedChip({
  nip05,
  state = "idle",
  className,
}: {
  nip05: string;
  state?: Nip05State;
  className?: string;
}) {
  const display = nip05.replace(/^_@/, "");
  const base = cn("inline-flex items-center gap-1 text-xs text-muted", className);

  if (state === "verified") {
    return (
      <span className={base} title={`NIP-05 verified: ${nip05}`}>
        <HugeiconsIcon icon={CheckmarkBadge01Icon} size={13} strokeWidth={2} className="text-ink" aria-hidden />
        <span className="sr-only">NIP-05 verified </span>
        {display}
      </span>
    );
  }

  if (state === "mismatch") {
    return (
      <span className={base} title={`NIP-05 does not match this account: ${nip05}`}>
        <HugeiconsIcon icon={AlertCircleIcon} size={13} strokeWidth={2} aria-hidden />
        <span className="sr-only">NIP-05 unverified, does not match this account: </span>
        {display}
      </span>
    );
  }

  // idle / verifying / error: claimed but not (yet) verified — no badge.
  return (
    <span className={base} title={`NIP-05 claimed but not verified: ${nip05}`}>
      <span className="sr-only">NIP-05 claimed but not verified: </span>
      {display}
    </span>
  );
}

/**
 * "In your network" signal: the viewer follows this author (Web-of-Trust depth-1). A quiet ink glyph (no
 * accent — that stays reserved for the primary action), with the meaning in the tooltip + sr-only text.
 */
export function InNetworkBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center text-xs text-muted", className)}
      title="In your network — you follow this account"
    >
      <HugeiconsIcon icon={UserCheck01Icon} size={13} strokeWidth={2} className="text-ink" aria-hidden />
      <span className="sr-only">In your network</span>
    </span>
  );
}
