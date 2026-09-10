import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { getActivityWeekStart, israelDateAnchor, resolveGroup } from '@/lib/utils';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { fetchWeeklyVolume } from '@/lib/athletes/weekly-volume';

export const dynamic = 'force-dynamic';

// GET /api/coach/volume?weeks=8
// Team volume overview: every active athlete's recent weekly km, so a coach can
// spot who's ramping up or dropping off at a glance. Staff-only
// (coach/admin/academy_coach, or super-user), from the verified session. Returns
// per-athlete { series[], thisWeekKm, deltaKm, avgKm } plus the shared week axis,
// sorted by this-week volume desc.
//
// Bucketed from the activities rather than read off weekly_km_snapshots, which
// mixes two week anchors and drew this chart three phantom columns — see
// lib/athletes/weekly-volume.ts for the measurements.
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

    // The axis is the `weeks` weeks ending with the one the club is standing in,
    // generated rather than collected from the data: a week nobody ran has to be a
    // visible zero, not a missing column that quietly shortens the chart.
    const { weeks: weekAxis, byAthlete } = await fetchWeeklyVolume(supabase, {
      athleteIds,
      weeks,
      currentWeekStart: getActivityWeekStart(israelDateAnchor()),
    });

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const out = athleteIds.map((id) => {
      const m = meta.get(id)!;
      const buckets = byAthlete.get(id)!;
      const series = buckets.map((b) => round1(b.meters / 1000));
      const runsSeries = buckets.map((b) => b.runs);
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
