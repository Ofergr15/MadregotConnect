import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/public/stats — PUBLIC, unauthenticated. Aggregate social-proof numbers
 * for the landing page only. No private/individual data beyond top-3 name+time
 * (which are already shown publicly on the Races board). Everything is guarded so
 * an unmigrated DB just yields zeros / empty.
 */
export async function GET() {
  const out = {
    athletes: 0,
    totalKm: 0,
    workouts: 0,
    topResults: [] as { name: string; timeSeconds: number; test: string }[],
  };

  try {
    const supabase = createServerClient();

    // Active athletes count.
    const { count: athleteCount } = await supabase
      .from('athletes')
      .select('id', { count: 'exact', head: true })
      .eq('coach_id', COACH_ID)
      .eq('status', 'active');
    out.athletes = athleteCount || 0;

    // Total km + workouts across all synced activities for the coach's athletes.
    // (Fetch ids first — activities aren't coach-scoped directly.)
    const { data: ath } = await supabase
      .from('athletes').select('id').eq('coach_id', COACH_ID);
    const ids = (ath || []).map((a: any) => a.id);
    if (ids.length) {
      const { data: acts } = await supabase
        .from('athlete_activities')
        .select('distance')
        .in('athlete_id', ids);
      const rows = acts || [];
      out.workouts = rows.length;
      out.totalKm = Math.round(rows.reduce((s: number, r: any) => s + (Number(r.distance) || 0), 0) / 1000);
    }

    // Top-3 approved 2000m (or the first available test).
    const { data: bench } = await supabase
      .from('benchmark_results')
      .select('athlete_name, time_seconds, test_name, status')
      .eq('coach_id', COACH_ID)
      .order('time_seconds', { ascending: true });
    if (bench && bench.length) {
      const approved = bench.filter((b: any) => (b.status ?? 'approved') === 'approved');
      const test = approved.find((b: any) => b.test_name === '2000m')?.test_name || approved[0]?.test_name;
      out.topResults = approved
        .filter((b: any) => b.test_name === test)
        .slice(0, 3)
        .map((b: any) => ({ name: b.athlete_name, timeSeconds: Number(b.time_seconds), test: b.test_name }));
    }
  } catch (e) {
    // Public endpoint — never error; just return whatever we have.
    console.error('public stats error:', e);
  }

  return NextResponse.json(out);
}
