"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * localStorage-backed state, SSR-safe. The stored value is loaded in an effect (after mount), so the
 * server render and the first client render both use `initial` and there is no hydration mismatch; the
 * persisted value is applied a tick later. Writes are JSON-serialized and quota/private-mode errors are
 * swallowed (the value stays in memory).
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // unreadable / not JSON: keep initial
    }
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // quota exceeded / private mode: keep the in-memory value
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
