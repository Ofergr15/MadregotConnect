'use client';

import { useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import type { StreamKmSplit, StreamView } from '@/lib/activities/stream-view';

export interface ActivityStreamData {
  stream: StreamView | null;
  kmSplits: StreamKmSplit[];
  laps: Array<{ distance: number; duration: number; pace: number | null; hr: number | null; intensity: string | null }>;
  zones: number[] | null;
  maxHr: number;
  hrVisible: boolean;
}

/**
 * The run's 1 Hz trace, as the run page draws it (GET /api/activities/stream).
 * `data` stays null while loading and for a run with no trace — the page then
 * draws from the per-km splits it already has. Only uuids have a trace row.
 */
export function useActivityStream(activityId: string | null | undefined) {
  const [data, setData] = useState<ActivityStreamData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activityId || !/^[0-9a-f-]{36}$/i.test(activityId)) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/activities/stream?activityId=${encodeURIComponent(activityId)}`, {
          headers: await apiHeaders(),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.stream) setData(json as ActivityStreamData);
      } catch { /* charts fall back to the splits */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  return { data, loading };
}
