import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/athletes/prs?athleteId=…
// Auto-detected Personal Records from the athlete's FULL run history in
// athlete_activities (Garmin + Strava write the same table/units: distance in
// meters, duration in seconds). Whole-activity distance-time bests only — no new
// data capture. Scoped like the activities API: a caller may fetch their own
// PRs; verified staff (coach/admin/academy_coach via x-user-email) may fetch any.
//
// Distance bests use a tolerance window so real-world runs (never exactly 5.00km)
// still count as a "5K effort". We take the fastest qualifying run per bucket.
const BUCKETS: Array<{ key: string; label: string; meters: number; tolerance: number }> = [
  { key: '5k', label: '5K', meters: 5000, tolerance: 0.06 },   // 4.70–5.30 km
  { key: '10k', label: '10K', meters: 10000, tolerance: 0.05 }, // 9.5–10.5 km
  { key: 'hm', label: 'Half Marathon', meters: 21097, tolerance: 0.04 }, // ~20.25–21.94 km
  { key: 'fm', label: 'Marathon', meters: 42195, tolerance: 0.03 }, // ~40.9–43.5 km
];

// Runs only — exclude walks/other; matches the sync-time run-type filter.
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    // Authorization: caller must own this athleteId or be staff.
    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    let allowed = false;
    if (isSuperUser(email)) {
      allowed = true; // super user may view any athlete's PRs (consistent w/ view-as)
    } else if (email) {
      const { data: caller } = await supabase
        .from('athletes')
        .select('id, role')
        .eq('email', email)
        .maybeSingle();
      const isStaff = !!caller && ['coach', 'admin', 'academy_coach'].includes((caller as any).role);
      allowed = isStaff || (caller as any)?.id === athleteId;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Full run history for this athlete (no 200-row feed cap here).
    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('activity_name, activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false });
    if (error) throw error;

    const runs = (acts || []).filter(
      (a: any) => a.distance > 0 && a.duration > 0 && (!a.activity_type || RUN_TYPES.includes(a.activity_type))
    );

    // Distance-time bests: fastest qualifying run per bucket.
    const distanceBests = BUCKETS.map((b) => {
      const lo = b.meters * (1 - b.tolerance);
      const hi = b.meters * (1 + b.tolerance);
      let best: any = null;
      for (const r of runs) {
        if (r.distance < lo || r.distance > hi) continue;
        // Normalize to the exact bucket distance so a 5.2km run's "5K time" is
        // comparable (scale duration by the bucket/actual distance ratio).
        const normalized = r.duration * (b.meters / r.distance);
        if (!best || normalized < best.seconds) {
          best = { seconds: Math.round(normalized), rawSeconds: r.duration, distanceM: r.distance, date: r.start_time, name: r.activity_name };
        }
      }
      return {
        key: b.key,
        label: b.label,
        meters: b.meters,
        seconds: best?.seconds ?? null,
        date: best?.date ?? null,
        activityName: best?.name ?? null,
      };
    });

    // Longest run — max single-activity distance (a milestone, not a time bucket).
    let longest: any = null;
    for (const r of runs) {
      if (!longest || r.distance > longest.distanceM) {
        longest = { distanceM: r.distance, date: r.start_time, name: r.activity_name };
      }
    }
    const longestRun = longest
      ? { meters: longest.distanceM, km: Math.round((longest.distanceM / 1000) * 10) / 10, date: longest.date, activityName: longest.name }
      : null;

    return NextResponse.json({ distanceBests, longestRun, totalRuns: runs.length });
  } catch (err: any) {
    console.error('PRs error:', err);
    return NextResponse.json({ error: err.message || 'Failed to compute PRs' }, { status: 500 });
  }
}
