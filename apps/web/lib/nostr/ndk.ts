/**
 * The single NDK instance for the whole app, created once at module scope (the official
 * @nostr-dev-kit/react pattern). Browser-only: the cache adapter and the WebSocket connection are
 * guarded behind `typeof window` so module evaluation is safe during SSR of client components, but
 * this module is fenced with `client-only` so a Server Component can never pull NDK into its graph.
 * See docs/STACK.md.
 */

import "client-only";
import NDK from "@nostr-dev-kit/ndk";
import NDKCacheAdapterDexie from "@nostr-dev-kit/cache-dexie";
import { DEFAULT_RELAYS } from "./relays";

const isBrowser = typeof window !== "undefined";

const cacheAdapter = isBrowser ? new NDKCacheAdapterDexie({ dbName: "voxboard" }) : undefined;

export const ndk = new NDK({
  explicitRelayUrls: [...DEFAULT_RELAYS],
  cacheAdapter,
  enableOutboxModel: true,
  // Do NOT inject the signed-in user's personal NIP-65 relays into the main pool on login. NDK's default
  // (`autoConnectUserRelays: true`) calls `pool.addRelay()` for every relay in the user's kind-10002 list,
  // so the relay-status indicator (which reads `ndk.pool`) fills with the user's relays, and any unreliable
  // one flaps and reads as "relays keep dropping." Voxboard reads board data from the board's relays + the
  // defaults, not the user's personal relays, and the outbox model still routes the user's own reads/writes
  // (votes, profile, publishes) to their relays on demand. So keep the main pool to the stable, known set.
  autoConnectUserRelays: false,
  // Runtime validation of filters/events in development; disabled in production for performance.
  aiGuardrails: process.env.NODE_ENV !== "production",
});

if (isBrowser) {
  // Fire-and-forget; NDK queues subscriptions until connected.
  void ndk.connect();
}
