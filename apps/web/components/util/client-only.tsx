"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

/**
 * True only after hydration. useSyncExternalStore renders the server snapshot (false) during SSR and the
 * first client paint, then the client snapshot (true) once hydrated, so it flips without a hydration
 * warning (the React-blessed pattern).
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // client
    () => false, // server + first hydration render
  );
}

/**
 * Render children only on the client (after hydration). For interactive, closed-at-load UI whose markup
 * has no SSR value and whose third-party custom elements (@tailwindplus/elements <el-dialog> etc.)
 * mutate their own DOM on upgrade — keeping them out of the SSR tree avoids a hydration attribute
 * mismatch entirely, and mounting the whole subtree client-side keeps ref-dependent effects correct.
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  return useHydrated() ? <>{children}</> : null;
}
