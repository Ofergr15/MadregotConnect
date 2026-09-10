import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getActivityWeekStart, israelDateAnchor } from '@/lib/utils';

/**
 * Recompute and persist weekly km per athlete (and, by group_id, per group)
 * into weekly_km_snapshots. Called after each sync so we keep a durable
 * history of the numbers even as activities change.
 *
 * By default it snapshots the current activity week and the previous one
 * (in case a late-arriving activity lands in last week). Weeks start on Monday
 * (`getActivityWeekStart`, re-split from the plan week on 2026-09-09) and are
 * keyed off Israel's calendar day.
 *
 * ⚠️ NOTHING DISPLAYS THIS TABLE, and nothing should start. Because only the
 * current and previous week are ever recomputed, the Monday→Sunday change on
 * 2026-08-21 left every older row keyed on the old anchor: 255 of 359 rows were
 * Monday-anchored, and 95 carry `runs: 0` from a pass whose window no longer lined
 * up with the row it was updating. Both volume charts read it and both drew
 * overlapping columns and rest weeks that never happened. They bucket the
 * activities now (`lib/athletes/weekly-volume.ts`), as does the profile km table.
 *
 * The 2026-09-09 re-split back to Monday makes this strictly worse, not better:
 * three weeks in the middle of the history are Sunday-keyed and everything either
 * side is Monday-keyed, so the table now holds THREE regimes. It is still only a
 * write.
 *
 * It is still written, as a cheap historical record of what the totals were on a
 * given day, and because re-keying it needs a migration applied by hand. If you
 * ever want to read it again, backfill it from the activities first — which is
 * what the readers already do, so there would be no point.
 */
export async function snapshotWeeklyKm(weeksBack = 1): Promise<{ weeks: string[]; rows: number }> {
  const supabase = createServerClient();

  // Which week-starts to (re)compute.
  const now = israelDateAnchor(); // Israel's calendar day, not the server's UTC one
  const weekStarts: string[] = [];
  for (let i = 0; i <= weeksBack; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const ws = getActivityWeekStart(d);
    if (!weekStarts.includes(ws)) weekStarts.push(ws);
  }

  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, group_id, status')
    .eq('coach_id', COACH_ID)
    .eq('status', 'active');

  const athleteIds = (athletes || []).map((a) => a.id);
  if (athleteIds.length === 0) return { weeks: weekStarts, rows: 0 };
  const groupByAthlete = new Map((athletes || []).map((a) => [a.id, a.group_id as string | null]));

  let rows = 0;
  for (const weekStart of weekStarts) {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const { data: activities } = await supabase
      .from('athlete_activities')
      .select('athlete_id, distance, duration, start_time')
      .in('athlete_id', athleteIds)
      .gte('start_time', weekStart)
      .lt('start_time', weekEndStr);

    // Aggregate per athlete.
    const stats = new Map<string, { distance: number; runs: number; duration: number }>();
    for (const act of activities || []) {
      const e = stats.get(act.athlete_id) || { distance: 0, runs: 0, duration: 0 };
      e.distance += Number(act.distance) || 0;
      e.runs += 1;
      e.duration += Number(act.duration) || 0;
      stats.set(act.athlete_id, e);
    }

    // Upsert one row per athlete for this week (including zeros, so the history
    // is complete and shareable).
    const payload = athleteIds.map((id) => {
      const s = stats.get(id) || { distance: 0, runs: 0, duration: 0 };
      return {
        athlete_id: id,
        group_id: groupByAthlete.get(id) || null,
        week_start: weekStart,
        distance_m: Math.round(s.distance),
        runs: s.runs,
        duration_s: Math.round(s.duration),
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('weekly_km_snapshots')
      .upsert(payload, { onConflict: 'athlete_id,week_start' });

    if (error) throw error;
    rows += payload.length;
  }

  return { weeks: weekStarts, rows };
}
