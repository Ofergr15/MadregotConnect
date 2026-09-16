'use client';

import { useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import type { SegmentReport, SegmentVerdict } from '@/lib/academy/segments';
import type { EffortReport } from '@/lib/academy/segments';

/**
 * One day's segment grading for one trainee, loaded on demand.
 *
 * Extracted from AcademyCompliance's `SegmentsPanel` because the weekly queue needs
 * exactly the same thing and nothing of the collapsed "פירוט לפי מקטע" chrome around
 * it: the queue lands the mentor ON the session, so there is no row to expand. The
 * part worth sharing is the SHAPING — `/api/academy/segments` answers with a flat
 * body and the feedback panel wants a `SegmentReport`, and two copies of that
 * mapping would drift the moment the route grows a field.
 */
export interface SegmentReportState {
  loading: boolean;
  segments: SegmentVerdict[] | null;
  report: SegmentReport | null;
  efforts: EffortReport | null;
  activityId: string | null;
  /** Why there is nothing to grade — a sentence for the reader, not an error code. */
  reason: string | null;
}

export function useSegmentReport(
  athleteId: string | null,
  date: string | null,
  /** False keeps it from firing for a row nobody has opened. */
  enabled = true,
): SegmentReportState {
  const [state, setState] = useState<SegmentReportState>({
    loading: false, segments: null, report: null, efforts: null, activityId: null, reason: null,
  });

  useEffect(() => {
    if (!enabled || !athleteId || !date) return;
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    (async () => {
      try {
        const res = await fetch(
          `/api/academy/segments?athleteId=${encodeURIComponent(athleteId)}&date=${date}`,
          { headers: await apiHeaders() },
        );
        const data = await res.json();
        if (cancelled) return;
        setState({
          loading: false,
          segments: data.segments || [],
          report: {
            aligned: !!data.aligned,
            segments: data.segments || [],
            gradedCount: data.gradedCount ?? 0,
            onTargetCount: data.onTargetCount ?? 0,
            reason: data.reason,
          },
          efforts: data.efforts || null,
          activityId: data.activityId ?? null,
          reason: data.aligned ? null : (data.reason || 'נתוני מקטעים לא זמינים'),
        });
      } catch {
        if (!cancelled) {
          setState(s => ({ ...s, loading: false, reason: 'טעינת המקטעים נכשלה' }));
        }
      }
    })();
    // Cancelled rather than aborted: the mentor moving down the queue fires a new
    // load per row, and a stale answer landing after a newer one would put another
    // trainee's laps under this trainee's name.
    return () => { cancelled = true; };
  }, [athleteId, date, enabled]);

  return state;
}
