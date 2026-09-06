import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { computeDistanceBests, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { attachLapsForPrs } from '@/lib/prs/attach-laps';
import {
  buildAllTimeTotals,
  buildKmTable,
  buildRecentRuns,
  computeLikeForLikeTrend,
  pickWeek,
} from '@/lib/athletes/profile-stats';
import { getActivityWeekStart, israelDateAnchor } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/athletes/[id]/stats?weeks=10&runs=5
//
// Everything the unified athlete profile needs about someone's training, in ONE
// request: all-time totals, the weekly km table, this week's km, the recent-runs
// list and the distance PRs.
//
// ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
// /api/athletes/summary, /volume-history and /prs already produce these numbers,
// but all three are `mayActFor`-gated — own athlete, staff or super-user — so a
// normal club member gets 403 on every one of them when looking at a teammate.
// The profile is one page with two viewers (you, and anyone else in the club),
// and it cannot have half its cards blank for the second one.
//
// The gate here is `requireMember`: logged in AND belongs to this club. That is
// the same gate the shared weekly program and the leaderboards use, and it is
// the right level for this content — a leaderboard already tells every member
// how far each teammate ran this week. Nothing owner-only is exposed: no email,
// no auth-provider state, no onboarding status. Compare /public, which is
// careful about exactly that.
//
// Three round trips per page (this, /public, /connections) rather than the six
// the owner's screens currently make, which is deliberate — per-page API
// fan-out is a live performance problem in this app.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const denied = await requireMember(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const weeks = Math.min(Math.max(Number(searchParams.get('weeks')) || 10, 1), 52);
    const runLimit = Math.min(Math.max(Number(searchParams.get('runs')) || 5, 1), 30);

    const supabase = createServerClient();

    // ONE read. Everything below is derived from the same set of activities, so
    // the totals, the weekly table, the trend badge and the PR grid cannot
    // disagree with each other — and there is no second table whose week anchor
    // could drift from this one's (see buildKmTable for the snapshots that did).
    const { data, error } = await supabase
      .from('athlete_activities')
      .select('id, activity_name, activity_type, start_time, distance, duration')
      .eq('athlete_id', id)
      .order('start_time', { ascending: false });

    if (error) throw error;
    const acts = (data || []) as RunActivityRow[];

    // Israel's calendar day, not the server's UTC one: between midnight and
    // 03:00 Israel time a raw `new Date()` still reads as yesterday, which on a
    // Sunday puts "this week" a whole week behind.
    const anchor = israelDateAnchor();
    const currentWeekStart = getActivityWeekStart(anchor);

    const weekTable = buildKmTable(acts, { limit: weeks, currentWeekStart });

    // Laps are pulled separately and only for the runs long enough to hold a PR
    // segment — see attach-laps.ts for why they don't ride along with the select
    // above, which everything else on this payload is built from.
    const prRuns = await attachLapsForPrs(supabase, id, filterQualifyingRuns(acts));

    return NextResponse.json({
      ...buildAllTimeTotals(acts),
      currentWeekStart,
      thisWeek: pickWeek(weekTable, currentWeekStart),
      // This week so far against the same slice of last week — not against last
      // week's total, which reads as a collapse every Monday.
      weekTrendPct: computeLikeForLikeTrend(acts, anchor),
      weeks: weekTable,
      recentRuns: buildRecentRuns(acts, runLimit),
      // Same bucket math as /api/athletes/prs and the badge award engine, so a
      // PR shown here is the one a "first 10K" badge fired on.
      prs: computeDistanceBests(prRuns),
    });
  } catch (error) {
    console.error('Failed to fetch athlete profile stats:', error);
    return NextResponse.json({ error: 'Failed to fetch athlete profile stats' }, { status: 500 });
  }
}
