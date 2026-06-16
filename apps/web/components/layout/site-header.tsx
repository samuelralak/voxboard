"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "./shell";
import { ThemeToggle } from "./theme-toggle";
import { AuthButton } from "./auth-button";
import { NotificationBell } from "./notification-bell";
import { ErrorBoundary } from "@/components/util/error-boundary";

/**
 * App header. Mostly static chrome with the interactive ThemeToggle and AuthButton islands. The
 * bottom hairline is transparent at the top of the page and only appears once content scrolls beneath,
 * so it reads as deliberate chrome rather than a stray rule over empty canvas. Discover stays reachable
 * at every width (it is the only other top-level destination).
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-40 border-b border-transparent bg-canvas/80 backdrop-blur transition-colors data-[scrolled=true]:border-border"
    >
      <Shell className="flex h-14 items-center justify-between">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight text-ink">
          Voxboard
        </Link>
        <nav className="flex items-center gap-1.5">
          <Link
            href="/discover"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Discover
          </Link>
          <ErrorBoundary>
            <NotificationBell />
          </ErrorBoundary>
          <ThemeToggle />
          <AuthButton />
        </nav>
      </Shell>
    </header>
  );
}
