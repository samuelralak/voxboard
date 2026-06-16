"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defers mounting `children` until the row scrolls within a buffer of the viewport, so a long feed does
 * not mount every row at once. Each feed row opens a kind-0 profile lookup + a NIP-05 verify + a
 * Web-of-Trust check; without this a board with hundreds of ideas fires all of them on first paint.
 *
 * `eager` rows (the first EAGER_ROWS) mount immediately so SSR + first paint carry real content; the tail
 * renders a height-reserving placeholder until revealed. Once a row is shown it STAYS shown (mount-once):
 * no unmount flicker. Critically, EVERY row is wrapped in this same component type, so a score-driven
 * re-sort that moves a row across the eager boundary preserves the React instance by key instead of
 * tearing it down and remounting a blank placeholder. Plain IntersectionObserver, no dependency.
 */
export function LazyRow({
  children,
  minHeight = 120,
  eager = false,
}: {
  children: ReactNode;
  minHeight?: number;
  eager?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(eager);

  // A row that re-sorts INTO the eager band mounts at once (and, mount-once, stays mounted thereafter).
  useEffect(() => {
    if (eager) setShown(true);
  }, [eager]);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      // Mount ~800px before the row enters the viewport so its content is ready by the time it is seen.
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  // Reserve approximate height before reveal so the scrollbar and scroll position stay stable; once
  // shown, drop the reservation and let the real content set the height.
  return (
    <div ref={ref} style={shown ? undefined : { minHeight }}>
      {shown ? children : null}
    </div>
  );
}
