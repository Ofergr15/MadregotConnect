'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActivityDetails } from '@/lib/activities-client';
import { apiHeaders } from '@/lib/api';
import { projectBandsToBins, PlannedKmPoint } from '@/lib/academy/segments';
import type { ExecutionVerdict } from '@/lib/plan-execution/verdict';
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
 * planned pace projected onto the actual split distances, and whether the run
 * matched the plan.
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
  // Whether that overlay came from a continuous plan — the bins alone can't say,
  // because a 400 m recovery never empties a 1 km bin. See `isContinuousPlan`.
  const [plannedContinuous, setPlannedContinuous] = useState(false);
  const [verdict, setVerdict] = useState<ExecutionVerdict | null>(null);

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
      const segmentsUrl = (athlete: string, start: string) =>
        `/api/academy/segments?athleteId=${encodeURIComponent(athlete)}&date=${activityLocalDateStr(start)}`
        + `&bands=1&verdict=1&activityId=${encodeURIComponent(activityId)}`;
      // When the caller already knows whose run it is and when (the activity list),
      // the plan request goes out WITH the details instead of after them: it used
      // to wait the whole details round trip (lab 2026-10-17). Without them (a run
      // opened from the feed) it still has to wait for the row to name them.
      // Opened from the feed, only the run's id is known: the route then reads the
      // athlete and the day off the run itself, so it can still go out now.
      const byIdOnly = !aid || !st
        ? `/api/academy/segments?bands=1&verdict=1&activityId=${encodeURIComponent(activityId)}`
        : null;
      const early = (aid && st) || /^[0-9a-f-]{36}$/i.test(activityId)
        ? apiHeaders()
          .then((headers) => fetch(byIdOnly ?? segmentsUrl(aid!, st!), { headers }))
          // A 400 means the route couldn't name them either; ask the old way below.
          .then((r) => (r.status === 400 ? null : r))
          .catch(() => null)
        : null;
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

      // The day's plan, in one request: the pace bands for the chart overlay, and
      // the verdict on whether this run matched the plan. Best-effort throughout —
      // no plan for the day, or no paced steps in it, and neither appears.
      //
      // The overlay is aligned to the ACTUAL split distances rather than assumed
      // kilometres, so it needs splits; the verdict doesn't, which is why the
      // request is no longer gated on having them.
      const useSplits = liveSplits.length ? liveSplits : (fs || []);
      const planAthleteId = aid || row?.athlete_id;
      const planStart = st || row?.start_time;
      if (planAthleteId && planStart) {
        try {
          const pr = (await early) ?? await fetch(segmentsUrl(planAthleteId, planStart), { headers: await apiHeaders() });
          if (pr.ok) {
            const pj = await pr.json();
            if (Array.isArray(pj?.bands) && pj.bands.length && useSplits.length >= 2) {
              const binMeters = useSplits.map((s) => s.distance || 1000);
              setPlanned(projectBandsToBins(pj.bands, binMeters));
              setPlannedContinuous(pj.continuous === true);
            }
            if (pj?.verdict) setVerdict(pj.verdict as ExecutionVerdict);
          }
        } catch { /* plan overlay + verdict optional */ }
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

  return { details, loading, error, planned, plannedContinuous, verdict, load };
}
