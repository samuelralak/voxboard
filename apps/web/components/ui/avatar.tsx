"use client";

import { useState } from "react";
import { isHttpUrl } from "@voxboard/protocol";
import { identiconGradient } from "@/lib/identicon";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";
type Shape = "circle" | "square";

const SIZE: Record<Size, string> = {
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
};

// People get a ringed circle; boards are objects, so a flat rounded tile with no ring. The shape sets
// radius and ring together, instead of a per-call rounded-md override fighting a baked-in ring.
const SHAPE: Record<Shape, string> = {
  circle: "rounded-full ring-1 ring-border",
  square: "rounded-md",
};

/**
 * Identity-bound avatar: the user's picture when present, otherwise a deterministic npub gradient disc
 * (NIP-163 spirit) so the same key always renders the same face and impostors are easy to spot. A
 * broken, dead-host, or non-http(s) picture URL falls back to the same gradient rather than the
 * browser's broken-image glyph.
 */
export function Avatar({
  pubkey,
  src,
  alt,
  size = "md",
  shape = "circle",
  className,
}: {
  pubkey: string;
  src?: string;
  alt?: string;
  size?: Size;
  shape?: Shape;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const base = cn("shrink-0 overflow-hidden", SHAPE[shape], SIZE[size], className);

  if (src && isHttpUrl(src) && !failed) {
    // Nostr avatars come from arbitrary hosts; a plain img avoids per-host remotePattern config.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className={cn(base, "object-cover")}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={base}
      style={{ background: identiconGradient(pubkey) }}
      role="img"
      aria-label={alt ?? "Identity avatar"}
    />
  );
}
