import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getActivityWeekStart } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface AthleteStat {
  athleteId: string;
  name: string;
  groupId: string | null;
  weekKm: number;
  weekRuns: number;
  weekDurationMin: number;
  totalKm: number;
  totalRuns: number;
  totalDurationMin: number;
}

/**
 * GET /api/academy/stats
 * Per-academy-athlete + team totals of REAL completed activity: workouts (runs),
 * km, and time — both this (Monday-based, activity) week and all-time.
 * Reuses the leaderboard Map-accumulate aggregation, scoped to academy athletes.
 */
export async function GET() {
  try {
    const supabase = createServerClient();

    // Academy athletes (graceful if is_academy not migrated).
    const athRes = await supabase
      .from('athletes')
      .select('id, name, group_id, is_academy')
      .eq('coach_id', COACH_ID);
    const athletes = athRes.error ? [] : (athRes.data || []).filter((a: any) => a.is_academy);

    if (!athletes.length) {
      return NextResponse.json({
        athletes: [] as AthleteStat[],
        team: { athletes: 0, weekKm: 0, weekRuns: 0, weekDurationMin: 0, totalKm: 0, totalRuns: 0, totalDurationMin: 0 },
        weekStart: getActivityWeekStart(new Date()),
      });
    }

    const athleteIds = athletes.map((a: any) => a.id);
    const weekStart = getActivityWeekStart(new Date());

    // All activities for these athletes (non-runs are filtered at ingest, so every
    // row is a run). distance = meters, duration = seconds.
    const { data: acts } = await supabase
      .from('athlete_activities')
      .select('athlete_id, distance, duration, start_time')
      .in('athlete_id', athleteIds);

    type Acc = { km: number; runs: number; dur: number };
    const zero = (): Acc => ({ km: 0, runs: 0, dur: 0 });
    const week = new Map<string, Acc>();
    const all = new Map<string, Acc>();

    for (const r of (acts || []) as any[]) {
      const dist = Number(r.distance) || 0;
      const dur = Number(r.duration) || 0;
      const a = all.get(r.athlete_id) || zero();
      a.km += dist; a.runs += 1; a.dur += dur;
      all.set(r.athlete_id, a);
      // Activity week start is a date string; compare on the timestamp's date.
      if ((r.start_time || '').split('T')[0] >= weekStart) {
        const w = week.get(r.athlete_id) || zero();
        w.km += dist; w.runs += 1; w.dur += dur;
        week.set(r.athlete_id, w);
      }
    }

    const round1 = (m: number) => Math.round(m / 100) / 10; // meters → km, 0.1
    const min = (s: number) => Math.round(s / 60);

    const result: AthleteStat[] = athletes.map((a: any) => {
      const w = week.get(a.id) || zero();
      const t = all.get(a.id) || zero();
      return {
        athleteId: a.id,
        name: a.name,
        groupId: a.group_id,
        weekKm: round1(w.km), weekRuns: w.runs, weekDurationMin: min(w.dur),
        totalKm: round1(t.km), totalRuns: t.runs, totalDurationMin: min(t.dur),
      };
    }).sort((x, y) => y.totalKm - x.totalKm);

    const team = result.reduce((acc, r) => ({
      athletes: acc.athletes + 1,
      weekKm: Math.round((acc.weekKm + r.weekKm) * 10) / 10,
      weekRuns: acc.weekRuns + r.weekRuns,
      weekDurationMin: acc.weekDurationMin + r.weekDurationMin,
      totalKm: Math.round((acc.totalKm + r.totalKm) * 10) / 10,
      totalRuns: acc.totalRuns + r.totalRuns,
      totalDurationMin: acc.totalDurationMin + r.totalDurationMin,
    }), { athletes: 0, weekKm: 0, weekRuns: 0, weekDurationMin: 0, totalKm: 0, totalRuns: 0, totalDurationMin: 0 });

    return NextResponse.json({ athletes: result, team, weekStart });
  } catch (error: any) {
    console.error('Academy stats error:', error);
    return NextResponse.json({ error: error.message || 'Failed to compute stats' }, { status: 500 });
  }
}
