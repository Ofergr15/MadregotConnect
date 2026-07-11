import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getActivityWeekStart } from '@/lib/utils';

/**
 * Recompute and persist weekly km per athlete (and, by group_id, per group)
 * into weekly_km_snapshots. Called after each sync so we keep a durable
 * history of the numbers even as activities change.
 *
 * By default it snapshots the current activity week and the previous one
 * (in case a late-arriving activity lands in last week). Weeks are Monday-based
 * to match Garmin/Strava.
 */
export async function snapshotWeeklyKm(weeksBack = 1): Promise<{ weeks: string[]; rows: number }> {
  const supabase = createServerClient();

  // Which week-starts to (re)compute.
  const now = new Date();
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
