"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Module-level cache, so switching tabs (or personas) shows the last known
// data instantly and refreshes behind it. Without this, every tab click
// nulls the data and flashes a skeleton — the single biggest source of
// "jumpiness" in the demo.
const CACHE = new Map<string, { data: unknown; at: Date }>();

/** Poll an async fetcher on an interval, stale-while-revalidate.
 *  - `cacheKey` identifies the dataset; a revisit renders from cache at once.
 *  - Skeletons should key off `data === null`, which now only happens on a
 *    genuine first load of that key.
 *  - Pauses while the tab is hidden. */
export function usePolled<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  intervalMs = 15000,
) {
  const cached = CACHE.get(cacheKey);
  const [data, setData] = useState<T | null>((cached?.data as T) ?? null);
  const [error, setError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(cached?.at ?? null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const d = await fetcherRef.current();
      const at = new Date();
      CACHE.set(cacheKey, { data: d, at });
      setData(d);
      setError("");
      setLastUpdated(at);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    // Serve whatever we already have for this key, then revalidate.
    const hit = CACHE.get(cacheKey);
    setData((hit?.data as T) ?? null);
    setLastUpdated(hit?.at ?? null);
    setError("");
    load();
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [cacheKey, load, intervalMs]);

  return { data, error, lastUpdated, isRefreshing, reload: load };
}

/** Drop cached datasets — used when switching persona so one role's rows can
 *  never be rendered under another's header, even for a frame. */
export function clearPolledCache(prefix?: string) {
  if (!prefix) return CACHE.clear();
  for (const k of [...CACHE.keys()]) if (k.startsWith(prefix)) CACHE.delete(k);
}
