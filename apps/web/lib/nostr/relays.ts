/**
 * Default relay set used to bootstrap discovery and as outbox fallbacks. Per-board relays (from the
 * community's `relay` tags) and per-user relays (NIP-65 kind 10002) take precedence at runtime; these
 * are only the starting points. See docs/STACK.md / PROTOCOL.md (outbox model).
 *
 * TODO(config): make this configurable and decide whether Voxboard runs its own relay (PLAN.md open item).
 */
export const DEFAULT_RELAYS = [
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://purplepag.es",
] as const;
