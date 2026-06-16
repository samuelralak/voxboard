"use client";

import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./use-local-storage";

const KEY = "vox:visited";
const CAP = 500; // keep the most-recent N idea ids so the list can't grow unbounded

export interface Visited {
  has: (id: string) => boolean;
  markVisited: (id: string) => void;
}

/**
 * Tracks which ideas the viewer has opened, so the feed can quietly de-emphasize ones they've already
 * read. Local-only (localStorage), most-recent-first, capped at CAP ids.
 */
export function useVisited(): Visited {
  const [ids, setIds] = useLocalStorage<string[]>(KEY, []);
  const set = useMemo(() => new Set(ids), [ids]);

  const has = useCallback((id: string) => set.has(id), [set]);

  const markVisited = useCallback(
    (id: string) => {
      setIds((prev) => {
        if (prev[0] === id) return prev; // already most-recent: no write
        const next = [id, ...prev.filter((x) => x !== id)];
        return next.length > CAP ? next.slice(0, CAP) : next;
      });
    },
    [setIds],
  );

  return { has, markVisited };
}
