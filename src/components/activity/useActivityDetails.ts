'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActivityDetails } from '@/lib/activities-client';
import { apiHeaders } from '@/lib/api';
import { projectBandsToBins, PlannedKmPoint } from '@/lib/academy/segments';
import { activityLocalDateStr } from '@/lib/utils';
import type { ActivityDetailsData, Split } from './types';

interface UseActivityDetailsArgs {
  activityId: string;
  /** Optional — narrows the lookup when the caller already knows the athlete. */
  athleteId?: string | null;
  /** For the planned-pace overlay. Falls back to the row the fetch returns. */
  startTime?: string | null;
  /** Splits the caller already holds, used to bin the plan before details land. */
  fallbackSplits?: Split[] | null;
  /** Fetch on mount (detail page) vs. on demand (feed card, on expand). */
  auto?: boolean;
}

/**
 * Loads one activity's route, splits and summary — plus, best-effort, that day's
 * planned pace projected onto the actual split distances.
 *
 * Extracted from ActivityFeed so the feed card and the standalone detail page
 * fetch identically: the plan overlay in particular is easy to get subtly wrong
 * (splits aren't always 1km — intervals auto-lap per step) and there should only
 * ever be one copy of it.
 */
export function useActivityDetails({
  activityId,
  athleteId,
  startTime,
  fallbackSplits,
  auto = false,
}: UseActivityDetailsArgs) {
  const [details, setDetails] = useState<ActivityDetailsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<(PlannedKmPoint | null)[] | null>(null);

  // The non-id inputs live in a ref so `load` stays stable across renders: the
  // caller passes an array (`fallbackSplits`) that's a fresh identity every
  // render, and a `load` that changed every render would re-fire the effect.
  const argsRef = useRef({ athleteId, startTime, fallbackSplits });
  argsRef.current = { athleteId, startTime, fallbackSplits };
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { athleteId: aid, startTime: st, fallbackSplits: fs } = argsRef.current;
      const res = await fetchActivityDetails(activityId, aid);
      let liveSplits: Split[] = [];
      let row: ActivityDetailsData['activity'] = null;
      if (res.ok) {
        const d = await res.json();
        setDetails(d);
        if (Array.isArray(d?.splits)) liveSplits = d.splits;
        row = d?.activity ?? null;
      } else {
        setError(res.status === 404 ? 'not-found' : res.status === 403 ? 'forbidden' : 'failed');
      }

      // Overlay the day's planned pace, aligned to the ACTUAL split distances.
      // Fetch the plan as meter bands, then project onto each split's distance.
      // Best-effort: no plan / no paced steps → no overlay.
      const useSplits = liveSplits.length ? liveSplits : (fs || []);
      const planAthleteId = aid || row?.athlete_id;
      const planStart = st || row?.start_time;
      if (useSplits.length >= 2 && planAthleteId && planStart) {
        const date = activityLocalDateStr(planStart);
        try {
          const pr = await fetch(
            `/api/academy/segments?athleteId=${encodeURIComponent(planAthleteId)}&date=${date}&bands=1`,
            { headers: await apiHeaders() },
          );
          if (pr.ok) {
            const pj = await pr.json();
            if (Array.isArray(pj?.bands) && pj.bands.length) {
              const binMeters = useSplits.map((s) => s.distance || 1000);
              setPlanned(projectBandsToBins(pj.bands, binMeters));
            }
          }
        } catch { /* plan overlay optional */ }
      }
    } catch {
      setError('failed');
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    if (auto) load();
  }, [auto, load]);

  return { details, loading, error, planned, load };
}
