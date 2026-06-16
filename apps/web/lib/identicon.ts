/**
 * A deterministic gradient derived from a pubkey (NIP-163 spirit): the same npub always renders the
 * same two-tone disc, so impostors are easy to spot and avatars feel identity-bound, not decorative.
 * Returns a CSS gradient string for an inline `background` (a genuinely dynamic, computed value).
 */
export function identiconGradient(pubkey: string): string {
  const hex = pubkey || "0".repeat(64);
  const slice = (start: number, len: number) => parseInt(hex.slice(start, start + len) || "0", 16);
  const hueA = slice(0, 4) % 360;
  const hueB = (hueA + 40 + (slice(4, 4) % 160)) % 360; // ensure a related-but-distinct second hue
  const angle = slice(8, 2) % 360;
  return `linear-gradient(${angle}deg, hsl(${hueA} 62% 56%), hsl(${hueB} 68% 44%))`;
}
