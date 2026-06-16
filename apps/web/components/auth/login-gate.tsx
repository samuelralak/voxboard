"use client";

import { createContext, useCallback, useContext, useId, useMemo, useRef, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { openDialog } from "@/lib/dialog";
import { ClientOnly } from "@/components/util/client-only";
import { LoginDialog } from "./login-dialog";

interface LoginGateValue {
  /** Open the login dialog. */
  promptLogin: () => void;
  /** Run `action` if logged in; otherwise open the login dialog. Returns whether `action` ran. */
  requireLogin: (action?: () => void) => boolean;
}

const LoginGateContext = createContext<LoginGateValue | null>(null);

/**
 * Mounts the single app-wide LoginDialog and exposes an imperative way to open it. Write actions (vote,
 * compose, reply) call `requireLogin` so a logged-out click opens the dialog instead of failing. One
 * dialog for the whole app means one focus trap, one source of truth, and no duplicated markup.
 */
export function LoginGate({ children }: { children: ReactNode }) {
  const dialogId = useId();
  const { loggedIn } = useAuth();

  // The action a logged-out user was trying to take (cast a vote, open compose, start a board). It is
  // stashed when the gate opens the login dialog and replayed ONLY when a login actually completes
  // through that dialog (via onAuthenticated), so the user's first click is honored — and a background
  // session restore the user never initiated can never trigger it.
  const pendingAction = useRef<(() => void) | null>(null);

  // A direct login prompt (header "Log in", "Log in to reply") carries no deferred intent, so clear any
  // stale pending action first — otherwise an earlier, abandoned gated click could replay on this login.
  const promptLogin = useCallback(() => {
    pendingAction.current = null;
    openDialog(dialogId);
  }, [dialogId]);

  const requireLogin = useCallback(
    (action?: () => void) => {
      if (!loggedIn) {
        pendingAction.current = action ?? null;
        openDialog(dialogId);
        return false;
      }
      action?.();
      return true;
    },
    [loggedIn, dialogId],
  );

  // Called by LoginDialog the moment a sign-in through the dialog succeeds: replay and clear the intent.
  const replayPendingAction = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  const value = useMemo<LoginGateValue>(() => ({ promptLogin, requireLogin }), [promptLogin, requireLogin]);

  return (
    <LoginGateContext value={value}>
      {children}
      <ClientOnly>
        <LoginDialog dialogId={dialogId} onAuthenticated={replayPendingAction} />
      </ClientOnly>
    </LoginGateContext>
  );
}

export function useLoginGate(): LoginGateValue {
  const ctx = useContext(LoginGateContext);
  if (!ctx) throw new Error("useLoginGate must be used within <LoginGate>");
  return ctx;
}
