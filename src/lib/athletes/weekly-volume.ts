import type { createServerClient } from '@/lib/supabase/server';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { activityWeekStart, toISODate } from '@/lib/utils';

/**
 * Weekly km per athlete, bucketed from the activities themselves.
 *
 * ── WHY NOT weekly_km_snapshots ──────────────────────────────────────────────
 * Because its `week_start` anchor CHANGED mid-history and its old rows were never
 * re-keyed. Measured on production: of 359 snapshot rows, 255 are Monday-anchored
 * (everything before 2026-08-09) and the rest Sunday-anchored, so an axis built by
 * collecting the distinct `week_start` values — which is what both volume charts
 * did — comes back holding BOTH:
 *
 *   2026-08-03(Mon) 2026-08-09(Sun) 2026-08-10(Mon) 2026-08-16(Sun)
 *   2026-08-17(Mon) 2026-08-23(Sun) 2026-08-30(Sun) 2026-09-06(Sun)
 *
 * Eight columns for six weeks, three of them overlapping their neighbour by six
 * days. One athlete who has run 175-185 km every week since March was drawn as
 * `179.3  72.3  52.2  177.8  0  182.7  174.5  93.3` — two collapses and a rest
 * week they never took, on the screen a coach uses to decide who is overtrained.
 * The stray zero rows are real too: 95 of the 359 have `runs: 0`, written by a
 * snapshot pass whose window no longer lined up with the row it was updating.
 *
 * Re-keying the table would need a migration applied by hand, and would still be
 * recomputed from these same activities — so read the activities. Same call, for
 * the same reason, as `buildKmTable` in profile-stats.ts, and it means the km
 * table, the two volume charts, the leaderboards and the streak now all agree on
 * where a week starts.
 *
 * The axis is GENERATED from the current week backwards rather than read off the
 * data, so a week with no runs is a visible zero instead of a gap that silently
 * shortens the chart and hides a rest week.
 *
 * Weeks are Monday-anchored (`activityWeekStart`), so a column here is the same
 * seven days Garmin and Strava report — which is the whole point: this chart is
 * read next to a watch. `currentWeekStart` must therefore come from
 * `getActivityWeekStart`, never from a plan week.
 */

export interface WeekBucket {
  weekStart: string;
  meters: number;
  runs: number;
  seconds: number;
}

/** Rows this needs, which is `RunActivityRow` plus who ran it. */
type VolumeRow = RunActivityRow & { athlete_id: string };

/**
 * Supabase caps a select at 1000 rows (PostgREST `db-max-rows`) and returns the
 * truncation as a successful response, so a query that outgrows it under-reports
 * silently — the exact failure this file exists to stop. Measured: the 25-athlete
 * roster over 26 weeks is 2772 activities, and even the 8-week default is 900,
 * close enough that one new member would start eating weeks off the chart.
 */
const PAGE = 1000;

/** The `weeks` week-starts ending with `currentWeekStart`, oldest first. */
export function weekAxis(currentWeekStart: string, weeks: number): string[] {
  const cur = new Date(`${currentWeekStart}T00:00:00`);
  const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i * 7);
    out.push(toISODate(d));
  }
  return out;
}

export async function fetchWeeklyVolume(
  supabase: ReturnType<typeof createServerClient>,
  opts: { athleteIds: string[]; weeks: number; currentWeekStart: string },
): Promise<{ weeks: string[]; byAthlete: Map<string, WeekBucket[]> }> {
  const axis = weekAxis(opts.currentWeekStart, opts.weeks);
  const byAthlete = new Map<string, WeekBucket[]>();
  const blank = () => axis.map((weekStart) => ({ weekStart, meters: 0, runs: 0, seconds: 0 }));
  for (const id of opts.athleteIds) byAthlete.set(id, blank());
  if (opts.athleteIds.length === 0 || axis.length === 0) return { weeks: axis, byAthlete };

  const index = new Map(axis.map((w, i) => [w, i]));

  // `.order('id')` so the pages are a stable partition. Without a deterministic
  // sort, PostgREST is free to return rows in any order per request and a paged
  // walk can repeat one row and skip another — which here would show up as a
  // wrong kilometre total, not an error.
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('athlete_activities')
      .select('athlete_id, start_time, distance, duration, activity_type')
      .in('athlete_id', opts.athleteIds)
      .gte('start_time', axis[0])
      .order('id')
      .range(offset, offset + PAGE - 1)
      .returns<VolumeRow[]>();
    if (error) throw error;
    const rows = data || [];

    for (const r of filterQualifyingRuns(rows)) {
      // The week key comes from the date STRING, never from an instant:
      // `start_time` is wall clock stored as UTC, so reading it as an instant
      // pushes a 21:30 Saturday run into the next week.
      const i = index.get(activityWeekStart(r.start_time));
      if (i == null) continue; // a run in the current week but after the axis ends
      const bucket = byAthlete.get(r.athlete_id);
      if (!bucket) continue;
      bucket[i].meters += r.distance;
      bucket[i].runs += 1;
      bucket[i].seconds += r.duration || 0;
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return { weeks: axis, byAthlete };
}
