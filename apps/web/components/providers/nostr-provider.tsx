"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  useNDKInit,
  useNDKSessionMonitor,
  NDKSessionLocalStorage,
} from "@nostr-dev-kit/react";
import { ndk } from "@/lib/nostr/ndk";

/**
 * Restores persisted sessions from localStorage. Rendered only after mount so it never runs during
 * SSR (localStorage does not exist on the server, and Node 25 exposes only a partial shim).
 */
function SessionMonitor() {
  const [sessionStore] = useState(() => new NDKSessionLocalStorage());
  // follows:true loads the signed-in user's NIP-02 contact list into the session, powering the
  // viewer-specific Web-of-Trust signals (useFollows / useWebOfTrust).
  useNDKSessionMonitor(sessionStore, { profile: true, follows: true });
  return null;
}

/**
 * Registers the module-level NDK singleton into the @nostr-dev-kit/react stores. The registration runs
 * inside a useState initializer (i.e. on the first render, before children commit), so child NDK hooks
 * like useSubscribe/useProfileValue see an initialized instance immediately instead of erroring on the
 * first paint.
 */
export function NostrProvider({ children }: { children: ReactNode }) {
  const initNDK = useNDKInit();
  useState(() => {
    initNDK(ndk);
    return null;
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      {mounted ? <SessionMonitor /> : null}
      {children}
    </>
  );
}
