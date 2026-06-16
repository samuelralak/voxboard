/**
 * SSRF host filtering, shared by EVERY place that turns an untrusted, externally-supplied URL into an
 * outbound request: the web app's LNURL zap resolution AND the indexer's relay connections. Keeping one
 * implementation is the point — drift between two copies is exactly how an SSRF filter gets bypassed.
 * Runtime-neutral (no `client-only`): this module is imported by the Cloudflare Worker indexer too.
 */

/**
 * Block loopback / private / link-local / IP-literal hosts before any outbound request. The host is
 * canonicalized through the URL parser FIRST, so numeric/hex/octal/decimal IPv4 forms (e.g. 2130706433,
 * 0x7f000001, 0177.0.0.1) all normalize to dotted-decimal and are caught — the check must not run on the
 * raw string while fetch() normalizes it afterward. A legitimate relay / lightning-address host is always
 * a DNS name, so we reject ALL IP literals, internal or not.
 */
export function isUnsafeHost(domain: string): boolean {
  let host: string;
  try {
    host = new URL(`https://${domain}/`).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return true; // unparseable host => unsafe
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".onion")) {
    return true;
  }
  if (host.includes(":")) return true; // IPv6 (incl. ::1, ::ffff:127.0.0.1) and IPv4-mapped forms
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // any dotted-decimal IPv4 literal
  return false;
}

/**
 * True if `raw` is a relay URL safe to open an outbound WebSocket to: a parseable ws/wss URL whose host
 * is not loopback/private/an IP literal. Used at the indexer's relay boundary (track-time validation AND
 * a re-check at connect-time, because the persisted relay set is replayed by the keep-alive alarm).
 */
export function isSafeRelayUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return false;
  return !isUnsafeHost(url.hostname);
}
