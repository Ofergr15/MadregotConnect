import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveGroup } from '@/lib/utils';
import { requireStaff } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// GET /api/coach/volume?weeks=8
// Team volume overview: every active athlete's recent weekly km (from the
// durable weekly_km_snapshots table), so a coach can spot who's ramping up or
// dropping off at a glance. Staff-only (coach/admin/academy_coach, or
// super-user), from the verified session. Returns per-athlete { series[],
// thisWeekKm, deltaKm, avgKm } plus the shared week axis, sorted by this-week
// volume desc.
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const weeks = Math.min(Math.max(Number(searchParams.get('weeks')) || 8, 2), 26);

    // Staff auth from the verified session (mirror /api/coach/pulse). The old
    // `x-user-email` lookup meant one forged header returned every athlete's
    // full training volume — verified against production.
    const denied = await requireStaff(request);
    if (denied) return denied;

    // Active roster (name/squad).
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, name, avatar_url, group_id, groups(name)')
      .eq('coach_id', COACH_ID)
      .eq('status', 'active');
    const meta = new Map<string, { name: string; avatar: string | null; squad: string | null }>();
    (athletes || []).forEach((a: any) =>
      meta.set(a.id, { name: a.name || '', avatar: a.avatar_url || null, squad: a.groups?.name || null }));
    const athleteIds = [...meta.keys()];
    if (athleteIds.length === 0) return NextResponse.json({ weeks: [], athletes: [] });

    // All snapshot rows for these athletes; we take the most recent `weeks` weeks
    // present across the roster as the shared x-axis.
    const { data: snaps } = await supabase
      .from('weekly_km_snapshots')
      .select('athlete_id, week_start, distance_m, runs')
      .in('athlete_id', athleteIds)
      .order('week_start', { ascending: false });

    const allWeeks = Array.from(new Set((snaps || []).map((r: any) => r.week_start))).sort().reverse().slice(0, weeks);
    const weekAxis = allWeeks.slice().reverse(); // chronological
    const weekIndex = new Map(weekAxis.map((w, i) => [w, i]));

    // Per-athlete km series aligned to weekAxis (0 where no snapshot).
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const byAthlete = new Map<string, number[]>();
    const runsByAthlete = new Map<string, number[]>();
    for (const id of athleteIds) {
      byAthlete.set(id, new Array(weekAxis.length).fill(0));
      runsByAthlete.set(id, new Array(weekAxis.length).fill(0));
    }
    for (const r of (snaps || []) as any[]) {
      const idx = weekIndex.get(r.week_start);
      if (idx == null) continue;
      byAthlete.get(r.athlete_id)![idx] = round1((Number(r.distance_m) || 0) / 1000);
      runsByAthlete.get(r.athlete_id)![idx] = Number(r.runs) || 0;
    }

    const out = athleteIds.map((id) => {
      const m = meta.get(id)!;
      const series = byAthlete.get(id)!;
      const runsSeries = runsByAthlete.get(id)!;
      const rg = m.squad ? resolveGroup(m.squad) : null;
      const thisWeekKm = series[series.length - 1] ?? 0;
      const prevWeekKm = series[series.length - 2] ?? 0;
      const ran = series.filter((_, i) => runsSeries[i] > 0);
      const avgKm = ran.length ? round1(ran.reduce((a, b) => a + b, 0) / ran.length) : 0;
      const thisWeekRuns = runsSeries[runsSeries.length - 1] ?? 0;
      return {
        athleteId: id,
        name: m.name,
        avatarUrl: m.avatar,
        squad: m.squad,
        squadColor: rg?.hex || null,
        series,
        thisWeekKm,
        thisWeekRuns,
        deltaKm: round1(thisWeekKm - prevWeekKm),
        avgKm,
        peakKm: series.reduce((mx, k) => (k > mx ? k : mx), 0),
      };
    })
      // Athletes with any history first, then by this-week volume desc.
      .filter((a) => a.peakKm > 0)
      .sort((a, b) => b.thisWeekKm - a.thisWeekKm || b.avgKm - a.avgKm);

    return NextResponse.json({ weeks: weekAxis, athletes: out });
  } catch (err: any) {
    console.error('coach volume error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
