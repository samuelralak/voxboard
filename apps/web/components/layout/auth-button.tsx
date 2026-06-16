"use client";

import Link from "next/link";
import * as nip19 from "nostr-tools/nip19";
import { useProfileValue } from "@nostr-dev-kit/react";
import { useAuth } from "@/hooks/use-auth";
import { useLoginGate } from "@/components/auth/login-gate";
import { Avatar } from "@/components/ui/avatar";

/**
 * Header identity control. Logged out: a "Log in" button that opens the shared LoginDialog (via the
 * LoginGate). Logged in: the user's avatar (links to their profile) + Log out.
 */
export function AuthButton() {
  const { loggedIn, pubkey, logout } = useAuth();
  const profile = useProfileValue(pubkey ?? undefined);
  const { promptLogin } = useLoginGate();

  if (loggedIn && pubkey) {
    let npub = pubkey;
    try {
      npub = nip19.npubEncode(pubkey);
    } catch {
      // fall back to hex
    }
    const name = profile?.displayName ?? profile?.name;
    return (
      <div className="flex items-center gap-2">
        <Link
          href={`/o/${npub}`}
          aria-label={name ? `${name}'s profile` : "Your profile"}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar pubkey={pubkey} src={profile?.picture} alt={name ?? "You"} size="md" />
        </Link>
        <button
          type="button"
          onClick={logout}
          className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={promptLogin}
      className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Log in
    </button>
  );
}
