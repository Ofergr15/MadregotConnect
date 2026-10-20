import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { addDaysToDateStr, israelToday, planWeekStartOf } from '@/lib/utils';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { loadClubWeek, loadPlanBasis, loadThresholds, loadTrainees } from '@/lib/academy/book-server';
import { extractWorkouts } from '@/lib/academy/report';
import { laneForBand } from '@/lib/academy/group-lane';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { weekTotals } from '@/lib/academy/compliance';
import { absoluteToLibrary, fromLibrarySteps, sessionSize, structureName } from '@/lib/academy/book-steps';
import type { WeekBoard, WeekBoardWorkout } from '@/lib/academy/week-board';
import { boardRow, offLineOf, restDaysOf } from '@/lib/academy/board';
import { loadBoardMarks, rowMarks } from '@/lib/academy/board-server';
import { plannedLoad, restateOptions, restateSteps, shiftDate, thresholdOn } from '@/lib/academy/load';
import { athleteLoads, BACKFILL_DAYS } from '@/lib/academy/load-server';
import { loadStatus } from '@/lib/academy/pmc';
import { DISPLAY_REFERENCE } from '@/lib/academy/plan-basis';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { ParsedWorkout } from '@/lib/ai/types';
import { loadAthleteFeeds } from '@/lib/academy/data-feed-server';
import { feedBroken } from '@/lib/academy/data-feed';
import { loadTestState } from '@/lib/academy/test-state';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { COACH_ID } from '@/lib/constants';
import { planRowsFilter } from '@/lib/plans/scope';
import { watchDates } from '@/lib/academy/day-cards';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The reps' pace, but only when it was read off the WORK. On a session cut short the effort
 * search can come back with the warmup as its first verifiable block (`workPaceOf` takes the
 * first), and "the reps at 5:30" beside a 4:05 target is a false alarm about the one
 * session that matters. Trusted when its band is the work band the plan states.
 */
function workPaceOfRow(row: { workPace?: { actual: number; min: number; max: number } | null; pace: { plannedMin: number | null } }): number | null {
  const wp = row.workPace;
  if (!wp) return null;
  if (row.pace.plannedMin != null && Math.abs(wp.min - row.pace.plannedMin) > 10) return null;
  return wp.actual;
}

/**
 * GET /api/academy/week-board?athleteId=…&weekStart=YYYY-MM-DD — screen 4 of the book v3.
 *
 * One trainee's week, Sunday to Saturday, as the trainee AND the coach see it: every
 * planned workout with its compliance colour (lib/academy/compliance.ts), the week's
 * planned-versus-done totals, whether each session reached the watch, and the steps of each
 * so the next one can draw its profile and the workout screen can print it.
 *
 * Graded by `computeAcademyWeekAdherence`, the engine the home's rows and the
 * plan-vs-actual sheet use, so the strip cannot disagree with the sheet it opens. Each
 * row is graded by lib/academy/board.ts `boardRow`, which the month grid uses as well.
 *
 * Trainee-experience v2 (screen 2) adds, all optional so the coach's screen and an older
 * client read the same payload: the ⚡ of every run and of every planned session and the
 * week's two totals, the "▼ 6.2 ק״מ במקום 8" line, the footer marks (lib/academy/
 * board-server.ts), the rest days, and whether the load numbers are trusted yet. Pricing
 * a run with no stored load writes it (migration 142), except under view-as.
 *
 * WHO: `mayCoach` — the trainee, their coach, the manager.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    const asked = searchParams.get('weekStart') || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    const weekStart = planWeekStartOf(DATE.test(asked) ? asked : null);
    const weekEnd = addDaysToDateStr(weekStart, 6);

    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const today = israelToday();
    const canPlan = caller.athleteId !== athleteId && (caller.isStaff || caller.isSuperUser);
    // The loads of a run that has none stored yet are priced on the way (bounded, and
    // never written under view-as), as /api/academy/load does — one history, so the ⚡ tile
    // and the month's bars are the same numbers. A failure costs the ⚡, not the week.
    const loadsP = athleteLoads(supabase, athleteId, { since: shiftDate(today, -BACKFILL_DAYS), write: !caller.viewingAsBy, today })
      .catch((err) => {
        console.error('week-board loads failed (the week still answers):', err);
        return null;
      });
    const [report, deliveries, me, thresholds, loads, feeds, test, planRows] = await Promise.all([
      computeAcademyWeekAdherence({ weekStart, onlyAthleteId: athleteId, keepDetail: true }),
      supabase
        .from('workout_deliveries')
        .select('workout_date, status, plan_id, workout_key')
        .eq('athlete_id', athleteId)
        .gte('workout_date', weekStart)
        .lte('workout_date', weekEnd),
      supabase.from('athletes').select('id, name, academy_coach_id, academy_joined_on, group_id').eq('id', athleteId).maybeSingle()
        .then(res => (res.error && isMissingColumn(res.error)
          ? supabase.from('athletes').select('id, name, academy_coach_id, group_id').eq('id', athleteId).maybeSingle()
          : res)),
      loadThresholds(supabase, [athleteId]),
      loadsP,
      loadAthleteFeeds(supabase, athleteId),
      loadTestState(supabase, athleteId, today),
      // Which plan row the week is drawn from — "on the watch" counts only ITS deliveries.
      supabase
        .from('weekly_plans')
        .select('id, week_start_date, status, athlete_id')
        .eq('coach_id', COACH_ID)
        .or(planRowsFilter(athleteId))
        .eq('week_start_date', weekStart)
        .then(res => (res.error ? { data: [] } : res)),
    ]);
    // What excuses a session from "לא בוצע": a day before joining, an optional session,
    // a day after the watch stopped sending (data-feed.ts).
    const joinedOn = ((me.data as { academy_joined_on?: string | null } | null)?.academy_joined_on ?? null)?.slice(0, 10) ?? null;
    const feedLostOn = feedBroken(feeds.run) && feeds.run.days != null ? shiftDate(today, -feeds.run.days) : null;
    const thresholdSec = thresholds[athleteId] ?? null;

    let coachName: string | null = null;
    let coachGender: string | null = null;
    const coachId = (me.data as { academy_coach_id?: string | null } | null)?.academy_coach_id;
    if (coachId) {
      const { data } = await supabase.from('athletes').select('name, gender').eq('id', coachId).maybeSingle();
      coachName = (data as { name?: string } | null)?.name ?? null;
      coachGender = (data as { gender?: string | null } | null)?.gender ?? null;
    }

    const graded = report.athletes[0]?.week.workouts ?? [];
    // An academy-only trainee (no club group) never gets the CLUB week as theirs: until
    // their coach writes their own, the week is empty and says so (academy-dash.html).
    // Only a READ group_id of null says so: the fallback read (no migration columns) has no
    // group_id at all, and an unknown group must not take a club member's week away.
    const academyOnly = !!me.data && 'group_id' in (me.data as object) && (me.data as { group_id?: string | null }).group_id === null;
    const ownWeek = academyOnly ? await hasOwnWeek(supabase, athleteId, weekStart) : true;
    const rows = ownWeek ? graded : [];
    // The same rule as the trainee's home (day-cards.ts watchDates): a delivery counts only
    // when it is of the workout the day shows — for an academy-only trainee, their own row.
    const weekPlanRows = ((planRows.data || []) as Array<{ id: string; week_start_date: string; athlete_id: string | null; status: string | null }>)
      .filter(r => !academyOnly || r.athlete_id === athleteId);
    const onWatch = watchDates({
      dates: Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)),
      athleteId,
      planRows: weekPlanRows,
      deliveries: (deliveries.data || []) as Array<{ workout_date: string; status: string; plan_id?: string | null; workout_key?: string | null }>,
      weekStartOf: planWeekStartOf,
    });
    // The footer marks need only the matched runs, so they are read while the steps' lane
    // is resolved below rather than after it.
    const marksP = loadBoardMarks(supabase, {
      athleteId, weekStart, weekEnd,
      activityIds: rows.filter(r => r.completed && r.actual?.id).map(r => String(r.actual!.id)),
    }).catch((err) => {
      console.error('week-board marks failed (the week still answers):', err);
      return null;
    });

    // Whose paces the steps are in. A trainee with no plan of their own this week is graded
    // against the CLUB's week (report.ts: individual plan, else the shared one), so those
    // steps carry a squad's lane paces — lane 1's on a unified plan, which is what
    // `extractWorkouts` hands back for it. Restated against that lane's reference and drawn
    // at the trainee's own threshold, they read as the session at THEIR pace, which is
    // exactly what screen 1 offers to send; drawn as stored, an academy beginner would see
    // a sub-2:30 squad's 3:05 reps as their plan.
    const basis = rows.length > 0 ? await loadPlanBasis(supabase, athleteId, weekStart, thresholdSec) : null;
    const fromClub = !!basis?.fromClub;
    const referenceSec = basis?.referenceSec ?? thresholdSec ?? DISPLAY_REFERENCE;
    // A planned pace in the steps' own terms → the trainee's.
    const scale = basis?.scale ?? 1;
    const toTrainee = (sec: number | null) => (sec && scale !== 1 ? Math.round(sec * scale) : sec);
    // The same factor restates the steps the ⚡ is priced over: a club week priced as stored
    // would be the lane's session against the trainee's threshold.

    // ⚡: the stored load of each run, and the plan priced at the threshold valid TODAY,
    // over the same steps and estimate options /api/academy/load's planned week uses.
    const loadOf = new Map((loads?.rows ?? []).map(r => [r.activityId, r.load]));
    const loadT = loads ? thresholdOn(today, loads.tests)?.thresholdSec ?? null : null;
    const parsed = rows.map(r => r.detail?.workout).filter(Boolean) as ParsedWorkout[];
    const estimate = restateOptions(planEstimateOptions(parsed), scale);
    const marks = await marksP;
    /** Each row's planned ⚡ unrounded, for the week's sum. */
    const planRaw: number[] = [];

    const workouts: WeekBoardWorkout[] = rows.map((row) => {
      const steps = row.detail?.workout.steps ?? [];
      // Named from the structure, the way the book names it (`6 × 800 מ׳`) — the club's own
      // titles are day names (`שלישי`), which the row already says.
      const model = steps.length ? fromLibrarySteps(absoluteToLibrary(steps, referenceSec).steps) : null;
      // Sized as the home card sizes it (day-cards → todayCard): the same steps, reference
      // and threshold, so the row, the card and screen 4 print one number.
      const optional = !!row.detail?.workout.optional;
      const graded = boardRow(row, today, sessionSize(steps, referenceSec, basis?.drawAtSec ?? referenceSec), { optional, joinedOn, feedLostOn });
      const { plannedM } = graded;
      const activityId = row.actual?.id ? String(row.actual.id) : null;
      const runLoad = row.completed && activityId ? loadOf.get(activityId) : undefined;
      const planLoad = loadT && steps.length ? plannedLoad(restateSteps(steps, scale), loadT, estimate) : 0;
      // Neither an optional session nor a day before joining is planned load.
      planRaw.push(optional || graded.excuse === 'beforeJoin' ? 0 : planLoad);
      const plannedPace = row.pace.plannedMin && row.pace.plannedMax
        ? Math.round((row.pace.plannedMin + row.pace.plannedMax) / 2)
        : null;
      return {
        date: row.date,
        dayOfWeek: new Date(`${row.date}T12:00:00Z`).getUTCDay(),
        name: model ? structureName(model) : row.name,
        compliance: graded.compliance,
        plannedM,
        actualM: graded.actualM,
        // Without a test of their own, the planned minutes and pace would be a lane's (the
        // home card withholds them too): the distance stands, the rest waits for a test.
        plannedSec: thresholdSec ? graded.plannedSec : null,
        actualSec: graded.actualSec,
        plannedPace: thresholdSec ? toTrainee(plannedPace) : null,
        // The work's pace where the reps were read; the whole run's only when the session
        // was graded against a whole-session band — never a run average set beside a rep
        // target, which would call every interval session slow.
        actualPace: workPaceOfRow(row) ?? (row.pace.comparedMin != null && row.pace.comparedMin === row.pace.plannedMin ? row.pace.actual : null),
        onWatch: onWatch.has(row.date),
        steps,
        note: row.detail?.workout.description ?? null,
        activityId,
        load: runLoad != null ? Math.round(runLoad) : null,
        plannedLoad: planLoad > 0 ? Math.round(planLoad) : null,
        // Only what a coach or the trainee wrote (or a record) is a mark; computed for
        // every row so the coach's screen can draw them too.
        marks: marks ? rowMarks(marks, row.date, row.completed ? activityId : null) : {},
        offLine: offLineOf(graded),
        comment: (row.completed && activityId ? marks?.byActivity.get(activityId)?.comment : null) ?? null,
        ...(optional ? { optional: true } : {}),
        ...(graded.excuse ? { excuse: graded.excuse } : {}),
      };
    });

    // The week's runs no session claimed — a run on a rest day, the second run of a day:
    // their own rows ("ריצה לא מתוכננת"), in the done km, time and ⚡ (issue 25).
    const unplanned = (report.athletes[0]?.week.unmatched ?? []).map(a => ({
      activityId: String(a.id),
      date: a.date,
      distanceM: a.distance || null,
      durationSec: (a.movingDuration ?? a.duration) || null,
      load: loadOf.get(String(a.id)) != null ? Math.round(loadOf.get(String(a.id)) as number) : null,
    })).sort((x, y) => x.date.localeCompare(y.date));

    // The week's ⚡: planned = the plan's non-optional sessions summed unrounded and then
    // rounded, exactly as /api/academy/load sums this week's dashed frame, so the tile and
    // the bar print one number. Done = what the matched runs stored.
    const plannedLoadSum = planRaw.reduce((a, b) => a + b, 0);
    // Done = EVERY priced run of the week, planned or not — exactly what the month view's
    // weekly bar sums (load-payload `weekly`), so the tile and the bar print one number.
    const weekEndSoFar = weekEnd < today ? weekEnd : today;
    const doneLoadSum = (loads?.rows ?? [])
      .filter(r => r.date >= weekStart && r.date <= weekEndSoFar && r.load != null)
      .reduce((a, r) => a + (r.load ?? 0), 0);

    const body: WeekBoard = {
      weekStart,
      weekEnd,
      today,
      athlete: { id: athleteId, name: (me.data as { name?: string } | null)?.name ?? report.athletes[0]?.name ?? '' },
      coachName,
      coachGender,
      thresholdSec,
      referenceSec,
      fromClub,
      totals: {
        ...weekTotals([
          ...workouts.map(w => ({
            completed: w.compliance.color !== 'red' && w.compliance.color !== 'grey',
            plannedM: w.plannedM,
            actualM: w.actualM,
            plannedSec: w.plannedSec,
            actualSec: w.actualSec,
            notPlanned: w.excuse === 'optional' || w.excuse === 'beforeJoin',
          })),
          ...unplanned.map(u => ({ completed: true, plannedM: null, actualM: u.distanceM, plannedSec: null, actualSec: u.durationSec, notPlanned: true })),
        ]),
        plannedLoad: loadT && plannedLoadSum > 0 ? Math.round(plannedLoadSum) : null,
        doneLoad: loads ? Math.round(doneLoadSum) : null,
      },
      workouts,
      restDays: restDaysOf(weekStart, workouts.map(w => w.date)),
      unplanned,
      // The ⚡ tile only on numbers that mean something: not on a broken feed, not while
      // runs are still being priced.
      loadOk: !!loads && loadStatus(loads.rows, today, { feed: feeds.run, pending: loads.pending }).kind === 'ok',
      test,
      canWatch: feeds.canWatch,
      feedGap: feedBroken(feeds.run) && (feedLostOn == null || weekEnd >= feedLostOn) ? feeds.run : null,
      joinedOn,
      // The coach plans from this screen; the trainee only reads it.
      canPlan,
      ...(canPlan ? { groupDays: await groupDaysOf(supabase, athleteId, weekStart, referenceSec) } : {}),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('week-board error:', error);
    return NextResponse.json({ error: 'Failed to load the week' }, { status: 500 });
  }
}

/** Does this trainee have a weekly_plans row of their OWN for the week? A read error says yes. */
async function hasOwnWeek(supabase: ReturnType<typeof createServerClient>, athleteId: string, weekStart: string): Promise<boolean> {
  const { data, error } = await supabase.from('weekly_plans').select('id').eq('athlete_id', athleteId).eq('week_start_date', weekStart).limit(1);
  return error ? true : (data || []).length > 0;
}

/**
 * The group's session of each day this week, in the trainee's lane (their band's, else lane 2),
 * named the way the book names a structure; the club's own description when it has one.
 * Never throws: a missing club week is an empty list.
 */
async function groupDaysOf(supabase: ReturnType<typeof createServerClient>, athleteId: string, weekStart: string, referenceSec: number): Promise<Array<{ date: string; name: string }>> {
  try {
    const [club, trainees] = await Promise.all([loadClubWeek(supabase, weekStart), loadTrainees(supabase, [athleteId])]);
    if (!club) return [];
    const lane = laneForBand(trainees[0]?.bandNumber) ?? 2;
    const byDay = new Map<number, string[]>();
    for (const w of extractWorkouts(club, lane)) {
      if (typeof w?.dayOfWeek !== 'number' || !Array.isArray(w.steps) || !w.steps.length) continue;
      const model = fromLibrarySteps(absoluteToLibrary(w.steps, referenceSec).steps);
      const said = (w.description || '').trim();
      const name = said && said.length <= 60 ? said : model ? structureName(model) : w.name;
      byDay.set(w.dayOfWeek, [...(byDay.get(w.dayOfWeek) ?? []), name]);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, names]) => ({ date: addDaysToDateStr(weekStart, d), name: names.join(' · ') }));
  } catch (err) {
    console.error('week-board group days failed:', err);
    return [];
  }
}
