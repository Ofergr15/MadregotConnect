import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Club stats are counted from this date forward (the current season).
const SINCE = '2026-06-01';

/**
 * GET /api/public/stats — PUBLIC, unauthenticated. Aggregate social-proof numbers
 * for the landing page only. No private/individual data beyond top-3 name+time
 * (already public on the Races board). Guarded so an unmigrated DB yields zeros.
 */
export async function GET() {
  const out = {
    since: SINCE,
    athletes: 0,      // distinct runners with synced activity since SINCE
    totalKm: 0,
    workouts: 0,
    totalHours: 0,
    topResults: [] as { name: string; timeSeconds: number; test: string }[],
    testDate: null as string | null,   // recorded_on of the shown test
  };

  try {
    const supabase = createServerClient();

    // Totals across activities SINCE the season start for the coach's athletes.
    const { data: ath } = await supabase
      .from('athletes').select('id').eq('coach_id', COACH_ID);
    const ids = (ath || []).map((a: any) => a.id);
    if (ids.length) {
      const rows: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: page } = await supabase
          .from('athlete_activities')
          .select('distance, duration, athlete_id')
          .in('athlete_id', ids)
          .gte('start_time', `${SINCE}T00:00:00Z`)
          .range(offset, offset + 999);
        if (!page || page.length === 0) break;
        rows.push(...page);
        if (page.length < 1000) break;
      }
      out.workouts = rows.length;
      out.totalKm = Math.round(rows.reduce((s, r) => s + (Number(r.distance) || 0), 0) / 1000);
      out.totalHours = Math.round(rows.reduce((s, r) => s + (Number(r.duration) || 0), 0) / 3600);
      out.athletes = new Set(rows.map(r => r.athlete_id)).size;
    }

    // Top-3 approved 2000m (or the first available test), with the test date.
    const { data: bench } = await supabase
      .from('benchmark_results')
      .select('athlete_name, time_seconds, test_name, status, recorded_on')
      .eq('coach_id', COACH_ID)
      .order('time_seconds', { ascending: true });
    if (bench && bench.length) {
      const approved = bench.filter((b: any) => (b.status ?? 'approved') === 'approved');
      const test = approved.find((b: any) => b.test_name === '2000m')?.test_name || approved[0]?.test_name;
      const forTest = approved.filter((b: any) => b.test_name === test);
      out.topResults = forTest.slice(0, 3).map((b: any) => ({ name: b.athlete_name, timeSeconds: Number(b.time_seconds), test: b.test_name }));
      out.testDate = forTest.find((b: any) => b.recorded_on)?.recorded_on || null;
    }
  } catch (e) {
    console.error('public stats error:', e);
  }

  return NextResponse.json(out);
}
