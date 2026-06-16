"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useNDK,
  useNDKCurrentUser,
  useNDKSessionLogin,
  useNDKSessionLogout,
} from "@nostr-dev-kit/react";
import { NDKNip07Signer, NDKNip46Signer, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function hasNip07(): boolean {
  return typeof window !== "undefined" && "nostr" in window && Boolean((window as { nostr?: unknown }).nostr);
}

/**
 * Identity for Voxboard: three ways in (NIP-07 extension, NIP-46 bunker, nsec), all behind the NDK
 * session store so the login persists across reloads (see NostrProvider). Signing always happens in
 * the browser; private keys never reach the server. See docs/PROTOCOL.md.
 */
export function useAuth() {
  const { ndk } = useNDK();
  const user = useNDKCurrentUser();
  const sessionLogin = useNDKSessionLogin();
  const sessionLogout = useNDKSessionLogout();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // window.nostr is injected asynchronously by extensions, so re-check shortly after mount.
  const [hasExtension, setHasExtension] = useState(false);
  useEffect(() => {
    setHasExtension(hasNip07());
    const t = setTimeout(() => setHasExtension(hasNip07()), 600);
    return () => clearTimeout(t);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** NIP-07 browser extension (Alby, nos2x, ...). */
  const loginExtension = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!hasNip07()) throw new Error("No Nostr extension found. Install one (e.g. Alby or nos2x), or use a bunker / key.");
      const signer = new NDKNip07Signer();
      await signer.blockUntilReady();
      await sessionLogin(signer);
    } catch (e) {
      setError(messageOf(e, "Could not connect to your extension."));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [sessionLogin]);

  /** nsec private key (power-user fallback). Passed straight to the signer, never sent anywhere. */
  const loginNsec = useCallback(
    async (nsec: string) => {
      setBusy(true);
      setError(null);
      try {
        const signer = new NDKPrivateKeySigner(nsec.trim());
        await sessionLogin(signer);
      } catch {
        setError("That key could not be read. Paste a valid nsec (or hex) key.");
        throw new Error("invalid nsec");
      } finally {
        setBusy(false);
      }
    },
    [sessionLogin],
  );

  /** NIP-46 remote signer via a bunker:// token (a fresh local key is generated per session). */
  const loginBunker = useCallback(
    async (token: string) => {
      setBusy(true);
      setError(null);
      try {
        if (!ndk) throw new Error("Not ready yet, try again in a moment.");
        const local = NDKPrivateKeySigner.generate();
        const signer = NDKNip46Signer.bunker(ndk, token.trim(), local);
        await signer.blockUntilReady();
        await sessionLogin(signer);
      } catch (e) {
        setError(messageOf(e, "Could not connect to the remote signer."));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [ndk, sessionLogin],
  );

  const logout = useCallback(() => {
    if (user) sessionLogout(user.pubkey);
  }, [sessionLogout, user]);

  return {
    user,
    pubkey: user?.pubkey ?? null,
    loggedIn: Boolean(user),
    busy,
    error,
    clearError,
    hasExtension,
    loginExtension,
    loginNsec,
    loginBunker,
    logout,
  };
}
