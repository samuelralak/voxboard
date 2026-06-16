"use client";

import { useEffect, useState } from "react";

/**
 * idle      — no nip05 claimed
 * verifying — fetch in flight
 * verified  — the domain's .well-known/nostr.json maps the name to THIS pubkey
 * mismatch  — the domain answered, but maps the name to a different key (or not at all): do NOT trust
 * error     — could not determine (bad format, network/CORS/timeout): claimed-but-unverified, not a mismatch
 */
export type Nip05State = "idle" | "verifying" | "verified" | "mismatch" | "error";

interface Entry {
  names: Record<string, string>;
  ok: boolean; // the lookup itself succeeded (HTTP 2xx + JSON), regardless of whether the name matched
  at: number;
}

// Module-level cache + in-flight dedupe, keyed by `domain|local`, so N rows from the same identity do
// exactly one fetch. TTLs keep a verified handle from re-fetching on every scroll, and let a transient
// error retry sooner.
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const OK_TTL = 30 * 60 * 1000;
const ERR_TTL = 5 * 60 * 1000;

// A nip05 local-part is a restricted charset (NIP-05); validating it before interpolation blocks header
// /path injection and keeps us from fetching attacker-shaped URLs.
const LOCAL_RE = /^[a-z0-9._-]+$/;
const DOMAIN_RE = /^[a-z0-9.-]+(:\d+)?$/;

function parseNip05(nip05: string): { local: string; domain: string } | null {
  const at = nip05.indexOf("@");
  const local = (at === -1 ? "_" : nip05.slice(0, at)).toLowerCase();
  const domain = (at === -1 ? nip05 : nip05.slice(at + 1)).toLowerCase();
  if (!local || !domain || !LOCAL_RE.test(local) || !DOMAIN_RE.test(domain)) return null;
  return { local, domain };
}

async function resolve(local: string, domain: string, key: string): Promise<Entry> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async (): Promise<Entry> => {
    try {
      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
      // redirect:"error" — a NIP-05 endpoint must not redirect; following one would let a domain hand
      // verification to an unrelated host.
      const res = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return { names: {}, ok: false, at: Date.now() };
      const json: unknown = await res.json();
      const names =
        json && typeof json === "object" && "names" in json && (json as { names: unknown }).names &&
        typeof (json as { names: unknown }).names === "object"
          ? ((json as { names: Record<string, string> }).names)
          : {};
      return { names, ok: true, at: Date.now() };
    } catch {
      return { names: {}, ok: false, at: Date.now() };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/**
 * Verify a claimed NIP-05 identifier actually belongs to `pubkey` by round-tripping the domain's
 * .well-known/nostr.json. Fails CLOSED: anything we can't positively verify is reported as unverified
 * (error) or mismatch, never as verified. Runs only on the client (the result drives a display badge).
 */
export function useNip05Verify(nip05: string | undefined, pubkey: string): Nip05State {
  const [state, setState] = useState<Nip05State>("idle");

  useEffect(() => {
    if (!nip05) {
      setState("idle");
      return;
    }
    const parsed = parseNip05(nip05);
    if (!parsed) {
      setState("error");
      return;
    }
    const key = `${parsed.domain}|${parsed.local}`;
    const verdict = (entry: Entry): Nip05State => {
      if (!entry.ok) return "error";
      return entry.names[parsed.local] === pubkey ? "verified" : "mismatch";
    };

    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < (cached.ok ? OK_TTL : ERR_TTL)) {
      setState(verdict(cached)); // synchronous, no flicker on a warm cache
      return;
    }

    let active = true;
    setState("verifying");
    void resolve(parsed.local, parsed.domain, key).then((entry) => {
      cache.set(key, entry);
      if (active) setState(verdict(entry));
    });
    return () => {
      active = false;
    };
  }, [nip05, pubkey]);

  return state;
}
