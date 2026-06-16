"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { NostrProvider } from "./nostr-provider";
import { LoginGate } from "@/components/auth/login-gate";

/**
 * Single client-side provider boundary, mounted once in the root layout around `children`. Keeping it
 * shallow (it wraps only `children`, not <html>/<body>) lets Next keep the static shell as Server
 * Components. See docs/STACK.md and the Next "Context providers" guidance.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <NostrProvider>
        <LoginGate>{children}</LoginGate>
      </NostrProvider>
    </ThemeProvider>
  );
}
