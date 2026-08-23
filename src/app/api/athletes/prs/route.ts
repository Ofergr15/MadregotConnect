import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';
import { filterQualifyingRuns, computeDistanceBests } from '@/lib/prs/pr-buckets';

export const dynamic = 'force-dynamic';

// GET /api/athletes/prs?athleteId=…
// Auto-detected Personal Records from the athlete's FULL run history in
// athlete_activities (Garmin + Strava write the same table/units: distance in
// meters, duration in seconds). Whole-activity distance-time bests only — no new
// data capture. Scoped like the activities API: a caller may fetch their own
// PRs; verified staff (coach/admin/academy_coach via x-user-email) may fetch any.
//
// Bucket definitions + tolerance-window/run-type filtering live in
// lib/prs/pr-buckets.ts — the badge award engine's `pr_bucket` rule_type
// (059_badges.sql) reuses the EXACT same logic so a "first 5K" badge fires on
// the same run this route would show as the 5K PR.

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

    const runs = filterQualifyingRuns((acts || []) as any[]);

    // Distance-time bests: fastest qualifying run per bucket (shared w/ the
    // badge award engine's pr_bucket rule_type — see pr-buckets.ts).
    const distanceBests = computeDistanceBests(runs).map(({ activityId, ...rest }) => rest);

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

    // Best calendar month by total distance — a volume PR, distinct from the
    // per-run bests above. Calendar months (not rolling 30-day windows) since
    // that's how a runner naturally thinks of "my biggest month ever".
    const kmByMonth = new Map<string, number>(); // "YYYY-M" -> total meters
    for (const r of runs) {
      const d = new Date(r.start_time);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      kmByMonth.set(key, (kmByMonth.get(key) || 0) + r.distance);
    }
    let bestMonth: { year: number; month: number; km: number } | null = null;
    for (const [key, meters] of kmByMonth) {
      const [year, month] = key.split('-').map(Number);
      const km = Math.round((meters / 1000) * 10) / 10;
      if (!bestMonth || km > bestMonth.km) bestMonth = { year, month, km };
    }

    return NextResponse.json({ distanceBests, longestRun, bestMonth, totalRuns: runs.length });
  } catch (err: any) {
    console.error('PRs error:', err);
    return NextResponse.json({ error: err.message || 'Failed to compute PRs' }, { status: 500 });
  }
}
