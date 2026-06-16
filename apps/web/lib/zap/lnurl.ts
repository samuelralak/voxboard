import "client-only";

/**
 * Resolve a recipient's LNURL-pay metadata from their lightning address (lud16). The ONLY field that
 * matters for zap-receipt validation is `nostrPubkey` — the key the LNURL server uses to sign kind-9735
 * receipts, i.e. the trust anchor. We require `allowsNostr` + a valid `nostrPubkey`; an endpoint that is
 * not a Nostr-zap endpoint yields no anchor (its "receipts" can never be trusted, so totals stay 0).
 *
 * SSRF-hardened: https only, no loopback/private/link-local hosts (both the well-known domain AND the
 * returned callback host), `redirect: "error"`, short timeout. Cached + in-flight-deduped by lud16.
 */

export interface LnurlPayMeta {
  /** the LNURL server's nostr signing key — the zap-receipt trust anchor */
  nostrPubkey: string;
  callback: string;
  minSendableMsat: bigint;
  maxSendableMsat: bigint;
}

const HEX64 = /^[0-9a-f]{64}$/;
const NAME_RE = /^[a-z0-9-_.]+$/;
const DOMAIN_RE = /^[a-z0-9.-]+$/;
const TTL = 10 * 60 * 1000;

const cache = new Map<string, { meta: LnurlPayMeta | null; at: number }>();
const inflight = new Map<string, Promise<LnurlPayMeta | null>>();

function parseLud16(lud16: string): { name: string; domain: string } | null {
  const at = lud16.indexOf("@");
  if (at === -1) return null;
  const name = lud16.slice(0, at).toLowerCase();
  const domain = lud16.slice(at + 1).toLowerCase();
  if (!NAME_RE.test(name) || !DOMAIN_RE.test(domain)) return null;
  return { name, domain };
}

/**
 * Block loopback / private / link-local / IP-literal hosts before fetching. The host is canonicalized
 * through the URL parser FIRST, so numeric/hex/octal/decimal IPv4 forms (e.g. 2130706433, 0x7f000001,
 * 0177.0.0.1) all normalize to dotted-decimal and are caught — the check must not run on the raw string
 * while fetch() normalizes it afterward. A legitimate lightning-address domain is always a DNS name, so
 * we reject ALL IP literals, internal or not.
 */
function isUnsafeHost(domain: string): boolean {
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

async function doResolve(lud16: string): Promise<LnurlPayMeta | null> {
  const parsed = parseLud16(lud16);
  if (!parsed || isUnsafeHost(parsed.domain)) return null;
  try {
    const url = `https://${parsed.domain}/.well-known/lnurlp/${encodeURIComponent(parsed.name)}`;
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if (!json || json.tag !== "payRequest" || json.allowsNostr !== true) return null;

    const nostrPubkey = typeof json.nostrPubkey === "string" ? json.nostrPubkey.toLowerCase() : "";
    if (!HEX64.test(nostrPubkey)) return null;
    // The callback can point at a different host than the well-known domain, so it must clear the SAME
    // SSRF gate before the pay-flow ever fetches it — otherwise a hostile LNURL server could hand back an
    // https callback aimed at a loopback/internal address. Parse-and-canonicalize, then re-check the host.
    const callback = typeof json.callback === "string" ? json.callback : "";
    let callbackHost: string;
    try {
      const u = new URL(callback);
      if (u.protocol !== "https:") return null;
      callbackHost = u.hostname;
    } catch {
      return null;
    }
    if (isUnsafeHost(callbackHost)) return null;
    const min = Number(json.minSendable);
    const max = Number(json.maxSendable);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) return null;

    return {
      nostrPubkey,
      callback,
      minSendableMsat: BigInt(Math.floor(min)),
      maxSendableMsat: BigInt(Math.floor(max)),
    };
  } catch {
    return null;
  }
}

export async function resolveLnurlPay(lud16: string): Promise<LnurlPayMeta | null> {
  const cached = cache.get(lud16);
  if (cached && Date.now() - cached.at < TTL) return cached.meta;
  const existing = inflight.get(lud16);
  if (existing) return existing;

  const promise = (async () => {
    const meta = await doResolve(lud16);
    cache.set(lud16, { meta, at: Date.now() });
    inflight.delete(lud16);
    return meta;
  })();
  inflight.set(lud16, promise);
  return promise;
}
