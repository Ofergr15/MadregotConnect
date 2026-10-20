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

/** Minutes since a run ended; `start_time` is the runner's wall clock (Israel), not UTC. */
export function minutesSinceEnd(startTime: string | null | undefined, durationSec: number | null | undefined, now = new Date()): number | null {
  if (!startTime) return null;
  const start = Date.parse(`${startTime.slice(0, 19)}Z`);
  if (Number.isNaN(start)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  return (wall - start - (durationSec || 0) * 1000) / 60_000;
}

/** How long after a run the trace may still be on its way, and how often to ask again. */
export const STREAM_WAIT_MIN = 30;
const RETRY_MS = 45_000;

/**
 * The run's 1 Hz trace, as the run page draws it (GET /api/activities/stream).
 * `data` stays null while loading and for a run with no trace — the page then
 * draws from the per-km splits it already has. Only uuids have a trace row.
 *
 * The trace is stored a few minutes after the run itself syncs (2026-10-20: about six),
 * so a run opened straight from its notification used to stay on the per-km fallback
 * until a reload. With `waiting` (the run ended under half an hour ago) a missing trace
 * is asked for again every 45 s, and the page swaps to the full charts when it lands.
 */
export function useActivityStream(activityId: string | null | undefined, waiting = false) {
  const [data, setData] = useState<ActivityStreamData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activityId || !/^[0-9a-f-]{36}$/i.test(activityId)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    setLoading(true);
    const load = async () => {
      let got = false;
      try {
        const res = await fetch(`/api/activities/stream?activityId=${encodeURIComponent(activityId)}`, {
          headers: await apiHeaders(),
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json?.stream) { setData(json as ActivityStreamData); got = true; }
        }
      } catch { /* charts fall back to the splits */ } finally {
        if (!cancelled) setLoading(false);
      }
      if (!got && !cancelled && waiting && ++tries <= (STREAM_WAIT_MIN * 60_000) / RETRY_MS) timer = setTimeout(load, RETRY_MS);
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activityId, waiting]);

  return { data, loading };
}
