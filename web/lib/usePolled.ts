"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Poll an async fetcher on an interval. Pauses while the tab is hidden;
 *  refetches immediately when deps change. */
export function usePolled<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  intervalMs = 15000,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      setData(d);
      setError("");
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { data, error, lastUpdated, reload: load };
}
