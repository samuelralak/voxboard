/**
 * Client for the Voxboard Aggregator (docs/INDEXER.md). Optional: when NEXT_PUBLIC_INDEXER_URL is
 * unset (e.g. local dev without the Worker deployed), every call degrades gracefully to a no-op /
 * null, and the web app falls back to live client-side aggregation. When set, the aggregator is the
 * authoritative source for counts and sorting.
 */

import type { IdeaSort, IdeaStat } from "@voxboard/protocol";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "";

export interface BoardStats {
  coordinate: string | null;
  tracked: boolean;
  connectedRelays: number;
  configuredRelays: number;
  totalEvents: number;
  byKind: Record<number, number>;
  lastEventAt: number | null;
}

export function isIndexerConfigured(): boolean {
  return INDEXER_URL.length > 0;
}

/** Ask the aggregator to begin tracking a board (idempotent). No-op if the indexer is not configured. */
export async function trackBoard(coordinate: string, relays: string[]): Promise<void> {
  if (!INDEXER_URL) return;
  try {
    await fetch(`${INDEXER_URL}/v1/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinate, relays }),
    });
  } catch {
    // best-effort; the live client path still works without the indexer
  }
}

/** Fetch a board's aggregated stats, or null if the indexer is unavailable. */
export async function fetchBoardStats(coordinate: string): Promise<BoardStats | null> {
  if (!INDEXER_URL) return null;
  try {
    const res = await fetch(`${INDEXER_URL}/v1/stats?coordinate=${encodeURIComponent(coordinate)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as BoardStats;
  } catch {
    return null;
  }
}

/** Authoritative, sorted ideas for a board, or null to fall back to live client aggregation. */
export async function fetchBoardIdeas(
  coordinate: string,
  opts: { sort?: IdeaSort; status?: string; tag?: string } = {},
): Promise<IdeaStat[] | null> {
  if (!INDEXER_URL) return null;
  const query = new URLSearchParams({ coordinate });
  if (opts.sort) query.set("sort", opts.sort);
  if (opts.status) query.set("status", opts.status);
  if (opts.tag) query.set("tag", opts.tag);
  try {
    const res = await fetch(`${INDEXER_URL}/v1/ideas?${query.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { ideas: IdeaStat[] }).ideas;
  } catch {
    return null;
  }
}

/** Authoritative stats for a single idea, or null if unavailable. */
export async function fetchIdeaStats(coordinate: string, id: string): Promise<IdeaStat | null> {
  if (!INDEXER_URL) return null;
  try {
    const res = await fetch(
      `${INDEXER_URL}/v1/idea?coordinate=${encodeURIComponent(coordinate)}&id=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { idea: IdeaStat | null }).idea;
  } catch {
    return null;
  }
}
