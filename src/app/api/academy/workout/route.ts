import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { formatActivityTime, israelToday } from '@/lib/utils';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { computeAcademyWeekAdherence, sundayOf } from '@/lib/academy/report';
import { buildWorkoutSheet } from '@/lib/academy/workout-sheet';
import { toRoute } from '@/lib/feed/project';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { MAX_HR_DAYS, shiftDate, type TestPoint } from '@/lib/academy/load';
import { ACTIVITY_LOAD_COLUMNS, activityLoadBreakdown, loadTestsFor, maxHrNow, readAll } from '@/lib/academy/load-server';
import { buildWorkoutExtras, personalRecord, type WorkoutExtras } from '@/lib/academy/workout-extras';
import { loadPlanBasis } from '@/lib/academy/book-server';
import { feedbackKeysOf } from '@/lib/academy/board-server';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';
import { RECORD_DAYS, RECORD_MIN_M } from '@/lib/academy/records';

/**
 * How far back a personal record is looked for — the PR table's own window is a season,
 * read WHOLE (paged): a cap of the newest 200 runs left a 380-run trainee's season-best
 * 3:25 out of the pool and gave a 3:40 "שיא חדש … במקום 5:20".
 */
const PR_DAYS = RECORD_DAYS;

/**
 * Screens 4, 5 and 6's additions (lib/academy/workout-extras.ts): the expected ⚡ and its
 * parts, the watch ranges, "why this pace", the plan/done/diff table, the reps against the
 * watch range, a real PR, the watch's self-evaluation and the trainee's own answer.
 * Never fails the sheet: a read that breaks here costs the extras, not the screen.
 */
async function loadExtras(
  supabase: ReturnType<typeof createServerClient>,
  input: {
    athleteId: string; date: string; row: Parameters<typeof buildWorkoutExtras>[0]['row'];
    sheet: Parameters<typeof buildWorkoutExtras>[0]['sheet']; write: boolean;
  },
): Promise<WorkoutExtras | null> {
  try {
    const { athleteId, date, row } = input;
    const actId = row.actual?.id ?? null;
    const read = (cols: string) => supabase.from('athlete_activities').select(cols).eq('id', actId).eq('athlete_id', athleteId).maybeSingle();
    const [testsBy, actRes] = await Promise.all([
      loadTestsFor(supabase, [athleteId]),
      actId
        ? read(`${ACTIVITY_LOAD_COLUMNS}, garmin_activity_id, strava_activity_id, source, perceived_feel, perceived_rpe`).then(async (r) => (
          r.error && isMissingColumn(r.error) ? read(`${ACTIVITY_LOAD_COLUMNS}, garmin_activity_id`) : r))
        : Promise.resolve({ data: null, error: null }),
    ]);
    const tests: TestPoint[] = testsBy[athleteId] || [];
    // A club week's steps are in a lane's paces: restated to the trainee's newest threshold
    // (what the board draws them at) before they are priced or given a watch range.
    const basisP = loadPlanBasis(supabase, athleteId, sundayOf(date), tests.length ? tests[tests.length - 1].thresholdSec : null)
      .catch(() => null);
    const raw = (actRes.error ? null : actRes.data) as any;
    // PostgREST hands a NUMERIC column back as a string; the PR maths compares numbers.
    const toRun = (a: any) => ({ ...a, distance: Number(a.distance) || 0, duration: Number(a.duration) || 0 });
    const act = raw ? toRun(raw) : null;

    const steps = row.detail?.workout.steps ?? [];
    const hasCap = steps.some(s => (s.repeatSteps?.length ? s.repeatSteps : [s]).some(x => Number(x.targetHrMaxPct) > 0));
    // records.ts: a kilometre is the shortest record (a rep), so a shorter run holds none.
    const ownBests = act ? filterQualifyingRuns([act]).length > 0 && act.distance >= RECORD_MIN_M : false;

    const [breakdown, feedbackRes, historyRes, prRes] = await Promise.all([
      act ? activityLoadBreakdown(supabase, athleteId, act, { write: input.write, tests }) : Promise.resolve(null),
      // The run's own key, or the -strava key it was answered under before an upgrade (U12).
      act && feedbackKeysOf(act).length
        ? supabase
          .from('workout_feedback')
          .select('feel, difficulty, pain, garmin_activity_id')
          .eq('athlete_id', athleteId)
          .in('garmin_activity_id', feedbackKeysOf(act))
          .then(r => ({
            error: r.error,
            data: ((r.data || []) as any[]).sort((x, y) => feedbackKeysOf(act).indexOf(Number(x.garmin_activity_id)) - feedbackKeysOf(act).indexOf(Number(y.garmin_activity_id)))[0] ?? null,
          }))
        : Promise.resolve({ data: null, error: null }),
      hasCap
        ? supabase
          .from('athlete_activities')
          .select('start_time, activity_type, max_hr')
          .eq('athlete_id', athleteId)
          .gte('start_time', `${shiftDate(israelToday(), -MAX_HR_DAYS)}T00:00:00Z`)
        : Promise.resolve({ data: null, error: null }),
      // Only a run of a kilometre or more can be a record; only then are the season's
      // other runs (with their laps) read.
      ownBests
        ? readAll<any>((from, to) => supabase
          .from('athlete_activities')
          .select('id, start_time, activity_type, distance, duration, laps')
          .eq('athlete_id', athleteId)
          .gte('start_time', `${shiftDate(date, -PR_DAYS)}T00:00:00Z`)
          .gte('distance', RECORD_MIN_M)
          .order('start_time', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to), 200)
        : Promise.resolve({ data: null, error: null }),
    ]);
    const basis = await basisP;
    const history = (historyRes.error ? null : historyRes.data) as any[] | null;
    const others = (prRes.error ? null : prRes.data) as any[] | null;

    return buildWorkoutExtras({
      row,
      sheet: input.sheet,
      date,
      tests,
      planBasis: basis,
      actualLoad: breakdown?.load ?? null,
      maxHr: history ? maxHrNow(history, israelToday()) : null,
      activity: act,
      pr: act && others ? personalRecord(act, others.map(toRun)) : null,
      ownFeedback: (feedbackRes.error ? null : feedbackRes.data) as any,
    });
  } catch (err) {
    console.error('Academy workout extras failed (the sheet still answers):', err);
    return null;
  }
}

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/academy/workout?athleteId=…&date=YYYY-MM-DD
 *
 * One planned workout, planned vs actual — the sheet the trainee opens by tapping
 * a row on their academy home (mockup academy-plan-vs-actual).
 *
 * WHO: the trainee themselves, their own coach, and the manager — `mayCoach`, the
 * academy's 1:1 line, not `mayActFor`'s "any staff". A grade is between a runner
 * and their coach (see /api/plan-execution), and the coach's written feedback rides
 * along. Under the super user's view-as (lib/auth/view-as.ts, which covers
 * /api/academy/*) the caller IS the viewed person, so the same rule decides.
 *
 * WHAT: graded through `computeAcademyWeekAdherence` with `keepDetail` — the same
 * engine, attribution and tolerances as the home's row and the coach's compliance
 * table, so the sheet cannot disagree with the ring that opened it. The laps stay
 * here: `buildWorkoutSheet` reduces them to one point per rep or kilometre.
 *
 * Beside the sheet (screens 4/5/6 of trainee-experience-v2): `expectedLoad` +
 * `expectedParts`, `steps[].watchRange` (work steps only), `why`, `done`, `pr`,
 * `feelPrefill`, `feedback` and `activity` — see `loadExtras`. Pricing the run's ⚡ stores
 * its load (migration 142) unless the caller is viewing as someone.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    const date = searchParams.get('date') || '';
    if (!athleteId || !DATE_RE.test(date)) {
      return NextResponse.json({ error: 'athleteId and date (YYYY-MM-DD) are required' }, { status: 400 });
    }

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const report = await computeAcademyWeekAdherence({
      weekStart: sundayOf(date),
      onlyAthleteId: athleteId,
      keepDetail: true,
    });
    const row = report.athletes[0]?.week.workouts.find((w) => w.date === date);
    if (!row) return NextResponse.json({ error: 'no workout planned that day' }, { status: 404 });

    const supabase = createServerClient();
    const [activityRes, feedbackRes] = await Promise.all([
      row.actual
        ? supabase
          .from('athlete_activities')
          .select('id, start_time, location_name, route_preview')
          .eq('id', row.actual.id)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // The mentor's review of that day, if there is one. A missing table (the
      // hand-applied migration 103) reads as "no feedback yet", never as an error.
      supabase
        .from('academy_workout_feedback')
        .select('note, rendered, author_id')
        .eq('athlete_id', athleteId)
        .eq('workout_date', date)
        .maybeSingle(),
    ]);

    const activity = activityRes.data as {
      start_time: string | null; location_name: string | null; route_preview: unknown;
    } | null;

    let feedback: { text: string; mentorName: string | null } | null = null;
    const fb = feedbackRes.error ? null : feedbackRes.data as { note?: string; rendered?: string; author_id?: string } | null;
    if (fb) {
      // The mentor's own sentence when they wrote one; else the rendered review
      // without its first line, which only repeats the workout's name.
      const text = (fb.note || '').trim()
        || (fb.rendered || '').split('\n').slice(1).join('\n').trim();
      if (text) {
        let mentorName: string | null = null;
        if (fb.author_id) {
          const { data: author } = await supabase.from('athletes').select('name').eq('id', fb.author_id).maybeSingle();
          mentorName = (author as { name?: string } | null)?.name ?? null;
        }
        feedback = { text, mentorName };
      }
    }

    const sheet = buildWorkoutSheet({
      row,
      tolerances: report.tolerances,
      today: israelToday(),
      activity: activity
        ? {
          startClock: activity.start_time ? formatActivityTime(activity.start_time) : null,
          locationName: activity.location_name || null,
          route: toRoute(activity.route_preview),
        }
        : null,
      feedback,
    });
    const extras = await loadExtras(supabase, { athleteId, date, row, sheet, write: !caller.viewingAsBy });
    return NextResponse.json({ sheet, ...(extras ?? {}) });
  } catch (error: unknown) {
    console.error('Academy workout sheet error:', error);
    return NextResponse.json({ error: 'Failed to load the workout' }, { status: 500 });
  }
}
