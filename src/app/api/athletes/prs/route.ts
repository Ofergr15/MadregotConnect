import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { filterQualifyingRuns, computeDistanceBests, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { attachLapsForPrs } from '@/lib/prs/attach-laps';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { activityLocalDateStr } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/athletes/prs?athleteId=…
// Auto-detected Personal Records from the athlete's FULL run history in
// athlete_activities (Garmin + Strava write the same table/units: distance in
// meters, duration in seconds). Bests are the fastest continuous stretch of each
// bucket distance, taken from the laps already stored on the row when they are
// there and from the whole activity otherwise — no new data capture. Scoped like the activities API: a caller may fetch their own
// PRs; staff (coach/admin/academy_coach) may fetch any. Identity comes from the
// Supabase session, not from a header the caller writes themselves.
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

    // Authorization: caller must own this athleteId or be staff. The super user
    // may view anyone's PRs (consistent w/ view-as) — mayActFor covers that.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Full run history for this athlete — genuinely full, in pages. An
    // unpaginated select stops at PostgREST's 1000-row ceiling without saying so,
    // and since this one is ordered newest-first the thousand rows it kept were
    // the RECENT ones: the truncation removed exactly the older years a personal
    // best is most likely to sit in. See lib/supabase/paginate.ts for the
    // measured damage — three of one athlete's four bests were wrong, including a
    // run he had named "Massive 10k PB" that the card could not see.
    //
    // `start_time DESC` is kept because ties below resolve to the newest run, and
    // `id` is appended as a tiebreak so the paged walk is a stable partition
    // rather than two requests disagreeing about where the boundary was.
    const acts = await fetchAllRows<RunActivityRow>((from, to) =>
      supabase
        .from('athlete_activities')
        .select('id, activity_name, activity_type, start_time, distance, duration')
        .eq('athlete_id', athleteId)
        .order('start_time', { ascending: false })
        .order('id')
        .range(from, to),
    );

    const runs = await attachLapsForPrs(supabase, athleteId, filterQualifyingRuns(acts));

    // Distance-time bests: fastest qualifying run per bucket (shared w/ the
    // badge award engine's pr_bucket rule_type — see pr-buckets.ts).
    //
    // `activityId` used to be stripped here as payload the card didn't render. The
    // card now links each best to the run it was set on, which is the whole of a
    // report ("I want to open the run from day x from the data screen and I
    // can't") — a date and a run name are not something you can tap. Any club
    // member may open any member's run, so this is safe on a teammate's profile
    // too; see the note on /api/activities/details.
    const distanceBests = computeDistanceBests(runs);

    // Longest run — max single-activity distance (a milestone, not a time bucket).
    let longest: any = null;
    for (const r of runs) {
      if (!longest || r.distance > longest.distanceM) {
        longest = { id: r.id, distanceM: r.distance, date: r.start_time, name: r.activity_name };
      }
    }
    const longestRun = longest
      ? {
          meters: longest.distanceM,
          km: Math.round((longest.distanceM / 1000) * 10) / 10,
          date: longest.date,
          activityName: longest.name,
          activityId: longest.id,
        }
      : null;

    // Best calendar month by total distance — a volume PR, distinct from the
    // per-run bests above. Calendar months (not rolling 30-day windows) since
    // that's how a runner naturally thinks of "my biggest month ever".
    const kmByMonth = new Map<string, number>(); // "YYYY-M" -> total meters
    // Read the month off the stored string, not off local `Date` getters.
    // `start_time` holds the watch's local wall clock as a timestamptz, so
    // `new Date(...).getMonth()` shifts it a second time by the runtime's offset.
    // Correct today only because Vercel runs at TZ=UTC — in an Israel-timezone
    // runtime a run at 2026-07-31T23:30 would be credited to August, and if July
    // was the record month the athlete's biggest-month PR would silently change.
    for (const r of runs) {
      const [year, month] = activityLocalDateStr(r.start_time).split('-');
      const key = `${Number(year)}-${Number(month) - 1}`;
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
