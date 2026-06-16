/**
 * @voxboard/protocol — the shared Nostr event model for Voxboard.
 *
 * The single source of truth for how boards, ideas, replies, votes, status, and moderation are
 * encoded as Nostr events. Consumed by both the web app and the aggregator so they can never
 * disagree. See docs/PROTOCOL.md for the full specification.
 */

export * from "./kinds";
export * from "./event";
export * from "./sanitize";
export * from "./url";
export * from "./coords";
export * from "./scope";
export * from "./board";
export * from "./idea";
export * from "./reply";
export * from "./vote";
export * from "./bolt11";
export * from "./zap";
export * from "./thread";
export * from "./aggregate";
export * from "./status";
export * from "./moderation";
export * from "./approval";
export * from "./profile";
export * from "./delete";
