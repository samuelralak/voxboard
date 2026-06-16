"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defers mounting `children` until the row scrolls within a buffer of the viewport, so a long feed does
 * not mount every row at once. Each feed row opens a kind-0 profile lookup + a NIP-05 verify + a
 * Web-of-Trust check; without this a board with hundreds of ideas fires all of them on first paint.
 * Off-screen-below rows render a height-reserving placeholder so the scrollbar + scroll position stay
 * stable. Once a row is revealed it STAYS mounted: no unmount flicker, and no above-the-viewport reflow
 * jank (the failure mode of naive unmount-windowing when a row's real height differs from its estimate).
 * Plain IntersectionObserver, no dependency.
 */
export function LazyRow({ children, minHeight = 120 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

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
