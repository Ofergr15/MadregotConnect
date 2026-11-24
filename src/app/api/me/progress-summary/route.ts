import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { PR_RUN_TYPES, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { computeRecordHistory } from '@/lib/prs/record-history';
import { loadPrLaps, applyPrLaps } from '@/lib/prs/attach-laps';
import { readPrExclusions } from '@/lib/prs/exclusions-store';
import { classifyRun, paceAtHr, type PaceRunInput } from '@/lib/fitness/pace-at-hr';
import {
  activityLocalDateStr, activityWeekStart, addDaysToDateStr, computeWeekStreak,
  getActivityWeekStart, israelDateAnchor, israelToday,
} from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Months of pace-at-HR history: the profile's "1y" chart. */
const PACE_WEEKS = 52;

type Row = RunActivityRow & { id: string };

// GET /api/me/progress-summary
//   -> { paceAtHr: { band, months: [{ month, paceSecPerKm }] } | null,
//        records: { [bucket]: RecordBreak[] },
//        streak: { weeks, since, qualityDays } }
//
// The numbers behind the profile's progress cards, computed here so the native
// Profile need not download 200 activities to derive them. Read-only; nothing calls
// it yet. Every number comes from an existing helper — this only assembles them:
//   paceAtHr   lib/fitness/pace-at-hr (the PaceAtHrCard's own math), its headline
//              band's last shown point in each calendar month
//   records    computeRecordHistory with the same laps + exclusions as the stats route
//   streak     computeWeekStreak (activity week, Monday) — the momentum card's number;
//              qualityDays = distinct days inside it with a run classifyRun calls
//              interval or progressive
//
// The caller's own data only, and heart rate is health data — so there is no
// athlete parameter to widen. Both activity reads page past PostgREST's 1000 rows.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const athleteId = caller.athleteId;
  if (!athleteId) return NextResponse.json({ paceAtHr: null, records: {}, streak: { weeks: 0, since: null, qualityDays: 0 } });

  try {
    const supabase = createServerClient();
    const [runs, prLaps, exclusions] = await Promise.all([
      fetchAllRows<Row>((from, to) =>
        supabase.from('athlete_activities')
          .select('id, activity_name, activity_type, start_time, distance, duration')
          .eq('athlete_id', athleteId)
          .in('activity_type', PR_RUN_TYPES)
          .order('start_time', { ascending: true })
          .order('id')
          .range(from, to)),
      loadPrLaps(supabase, athleteId),
      readPrExclusions(supabase, athleteId),
    ]);

    const records = computeRecordHistory(applyPrLaps(filterQualifyingRuns(runs), prLaps), exclusions);

    const now = new Date();
    const weekKeys = new Set(runs.map(r => activityWeekStart(r.start_time)));
    const weeks = computeWeekStreak(weekKeys, now);
    const anchor = israelDateAnchor(now);
    const lastWeek = weekKeys.has(getActivityWeekStart(anchor))
      ? getActivityWeekStart(anchor)
      : getActivityWeekStart(new Date(anchor.getTime() - 7 * 86400_000));
    const since = weeks > 0 ? addDaysToDateStr(lastWeek, -7 * (weeks - 1)) : null;

    // Laps are the heavy column, so only over the window either card needs.
    const today = israelToday(now);
    const paceSince = addDaysToDateStr(today, -(7 * PACE_WEEKS + 29));
    const lapsSince = since && since < paceSince ? since : paceSince;
    const lapRuns = await fetchAllRows<PaceRunInput>((from, to) =>
      supabase.from('athlete_activities')
        .select('id, start_time, activity_type, distance, duration, laps')
        .eq('athlete_id', athleteId)
        .in('activity_type', PR_RUN_TYPES)
        .gte('start_time', `${lapsSince}T00:00:00`)
        .order('start_time', { ascending: true })
        .order('id')
        .range(from, to));

    const quality = new Set<string>();
    if (since) {
      for (const r of lapRuns) {
        const day = activityLocalDateStr(r.start_time);
        if (day < since) continue;
        const kind = classifyRun(r);
        if (kind === 'interval' || kind === 'progressive') quality.add(day);
      }
    }

    const chart = paceAtHr(lapRuns, { today, weeks: PACE_WEEKS });
    let pace: { band: number; months: Array<{ month: string; paceSecPerKm: number }> } | null = null;
    if (chart.headline) {
      const byMonth = new Map<string, number>();
      for (const p of chart.bands[chart.headline.band] || []) {
        if (p.paceSecPerKm != null) byMonth.set(p.date.slice(0, 7), p.paceSecPerKm);
      }
      pace = { band: chart.headline.band, months: [...byMonth].map(([month, paceSecPerKm]) => ({ month, paceSecPerKm })) };
    }

    return NextResponse.json({
      paceAtHr: pace,
      records,
      streak: { weeks, since, qualityDays: quality.size },
    });
  } catch (err: any) {
    console.error('[me/progress-summary] failed:', err);
    return NextResponse.json({ error: err?.message || 'Failed to load' }, { status: 500 });
  }
}
