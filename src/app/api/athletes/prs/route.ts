import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { mayActFor, requireCallerForAthlete, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { filterQualifyingRuns, computeDistanceBests, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { attachLapsForPrs } from '@/lib/prs/attach-laps';
import { applyPrOverrides, parsePrSeconds, prBucket, prSecondsProblem } from '@/lib/prs/overrides';
import { readPrOverrides, UNDEFINED_TABLE } from '@/lib/prs/overrides-store';
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
    // Layered with anything the athlete has stated by hand — see overrides.ts for
    // why a stated time replaces rather than competes with the derived one, and why
    // the badge engine deliberately never sees this.
    const distanceBests = applyPrOverrides(
      computeDistanceBests(runs),
      await readPrOverrides(supabase, athleteId),
    );

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

// PUT /api/athletes/prs { athleteId, bucketKey, time | seconds, achievedOn?, note?, hidden? }
// DELETE /api/athletes/prs?athleteId=…&bucketKey=…  → back to the derived best
//
// The athlete states (or takes down) one bucket's record — the answer to "the
// personal records can't be updated, there are old results" (affd459d) and to
// "my records here aren't correct" (a798197f). Everything else about PRs stays
// derived; see lib/prs/overrides.ts.
//
// On this route rather than a new endpoint on purpose: it already resolves the
// same identity for the same athlete's same numbers, and every route here runs as
// service-role, so a fifth PR endpoint would be a fifth thing to gate correctly.
// Self-or-staff via requireCallerForAthlete, the same check GET uses through
// mayActFor — a member may correct their own record and staff may correct anyone's,
// which is what a coach holding the race results actually needs.
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { athleteId, bucketKey } = body;
    if (!athleteId || !bucketKey) {
      return NextResponse.json({ error: 'athleteId and bucketKey required' }, { status: 400 });
    }

    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const bucket = prBucket(bucketKey);
    if (!bucket) return NextResponse.json({ error: 'unknown bucket', code: 'unknown-bucket' }, { status: 400 });

    const hidden = !!body.hidden;
    // `time` is what the sheet sends ("41:58"); `seconds` is accepted so a script
    // or a future caller doesn't have to format a number back into a string.
    let seconds: number | null = null;
    if (!hidden) {
      seconds = typeof body.seconds === 'number' ? Math.round(body.seconds) : parsePrSeconds(String(body.time ?? ''));
      if (seconds == null) {
        return NextResponse.json({ error: 'time must look like 41:58 or 3:12:40', code: 'unparseable' }, { status: 400 });
      }
      // Plausibility is per bucket — a 10-minute marathon and a 10-minute 5K are
      // not the same kind of wrong. The DB check is only a crude floor/ceiling.
      const problem = prSecondsProblem(bucketKey, seconds);
      if (problem) return NextResponse.json({ error: `time is ${problem}`, code: problem }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase.from('athlete_pr_overrides').upsert(
      {
        athlete_id: athleteId,
        bucket_key: bucketKey,
        seconds,
        achieved_on: (body.achievedOn && String(body.achievedOn)) || null,
        note: (body.note && String(body.note).trim().slice(0, 200)) || null,
        hidden,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'athlete_id,bucket_key' },
    );
    // Migration 104 is pasted in by hand, so until it is there is nothing to write
    // to. Said plainly rather than as a 500: the athlete's edit was not saved, and
    // a screen that claimed otherwise would be the worse failure.
    if ((error as { code?: string } | null)?.code === UNDEFINED_TABLE) {
      return NextResponse.json({ error: 'PR corrections are not enabled yet', code: 'not-migrated' }, { status: 501 });
    }
    if (error) throw error;

    return NextResponse.json({ success: true, bucketKey, seconds, hidden });
  } catch (err: any) {
    console.error('PR override save error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    const bucketKey = searchParams.get('bucketKey');
    if (!athleteId || !bucketKey) {
      return NextResponse.json({ error: 'athleteId and bucketKey required' }, { status: 400 });
    }

    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const supabase = createServerClient();
    const { error } = await supabase
      .from('athlete_pr_overrides')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('bucket_key', bucketKey);
    // Nothing to undo when the table isn't there — the bucket is already showing
    // the derived best, which is what deleting asks for.
    if (error && (error as { code?: string }).code !== UNDEFINED_TABLE) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('PR override delete error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete' }, { status: 500 });
  }
}
