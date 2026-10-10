import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { addDaysToDateStr, israelToday, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { loadClubWeek, loadLaneReferences, loadThresholds, loadTraineeWeeks } from '@/lib/academy/book-server';
import type { Lane } from '@/lib/academy/group-lane';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { weekTotals } from '@/lib/academy/compliance';
import { absoluteToLibrary, fromLibrarySteps, structureName } from '@/lib/academy/book-steps';
import type { WeekBoard, WeekBoardWorkout } from '@/lib/academy/week-board';
import { boardRow, offLineOf, restDaysOf } from '@/lib/academy/board';
import { loadBoardMarks, rowMarks } from '@/lib/academy/board-server';
import { plannedLoad, shiftDate, thresholdOn } from '@/lib/academy/load';
import { athleteLoads, BACKFILL_DAYS } from '@/lib/academy/load-server';
import { loadStatus } from '@/lib/academy/pmc';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { ParsedWorkout } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Restating paces needs A threshold; with no test, a typical one only names the session. */
const DISPLAY_REFERENCE = 300;

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
    // The loads of a run that has none stored yet are priced on the way (bounded, and
    // never written under view-as), as /api/academy/load does — one history, so the ⚡ tile
    // and the month's bars are the same numbers. A failure costs the ⚡, not the week.
    const loadsP = athleteLoads(supabase, athleteId, { since: shiftDate(today, -BACKFILL_DAYS), write: !caller.viewingAsBy, today })
      .catch((err) => {
        console.error('week-board loads failed (the week still answers):', err);
        return null;
      });
    const [report, deliveries, me, thresholds, loads] = await Promise.all([
      computeAcademyWeekAdherence({ weekStart, onlyAthleteId: athleteId, keepDetail: true }),
      supabase
        .from('workout_deliveries')
        .select('workout_date, status')
        .eq('athlete_id', athleteId)
        .gte('workout_date', weekStart)
        .lte('workout_date', weekEnd),
      supabase.from('athletes').select('id, name, academy_coach_id').eq('id', athleteId).maybeSingle(),
      loadThresholds(supabase, [athleteId]),
      loadsP,
    ]);
    const thresholdSec = thresholds[athleteId] ?? null;

    let coachName: string | null = null;
    const coachId = (me.data as { academy_coach_id?: string | null } | null)?.academy_coach_id;
    if (coachId) {
      const { data } = await supabase.from('athletes').select('name').eq('id', coachId).maybeSingle();
      coachName = (data as { name?: string } | null)?.name ?? null;
    }

    const onWatch = new Set(
      ((deliveries.data || []) as Array<{ workout_date: string; status: string }>)
        .filter(d => d.status === 'success')
        .map(d => d.workout_date),
    );
    const rows = report.athletes[0]?.week.workouts ?? [];
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
    const weeks = await loadTraineeWeeks(supabase, [athleteId], weekStart);
    const fromClub = rows.length > 0 && !weeks[athleteId]?.planId;
    let referenceSec = thresholdSec ?? DISPLAY_REFERENCE;
    if (fromClub) {
      const [club, refs, group] = await Promise.all([
        loadClubWeek(supabase, weekStart),
        loadLaneReferences(supabase),
        supabase.from('athletes').select('groups!group_id(name)').eq('id', athleteId).maybeSingle(),
      ]);
      const unified = Array.isArray((club as { workouts?: unknown } | null)?.workouts);
      const groupLane = resolveGroup((group.data as { groups?: { name?: string } } | null)?.groups?.name).index + 1;
      const lane = (unified ? 1 : groupLane >= 1 ? groupLane : 1) as Lane;
      referenceSec = refs[lane];
    }
    // A planned pace in the steps' own terms → the trainee's.
    const toTrainee = (sec: number | null) => (sec && fromClub && thresholdSec ? Math.round((sec * thresholdSec) / referenceSec) : sec);

    // ⚡: the stored load of each run, and the plan priced at the threshold valid TODAY,
    // over the same steps and estimate options /api/academy/load's planned week uses.
    const loadOf = new Map((loads?.rows ?? []).map(r => [r.activityId, r.load]));
    const loadT = loads ? thresholdOn(today, loads.tests)?.thresholdSec ?? null : null;
    const parsed = rows.map(r => r.detail?.workout).filter(Boolean) as ParsedWorkout[];
    const estimate = planEstimateOptions(parsed);
    const marks = await marksP;
    /** Each row's planned ⚡ unrounded, for the week's sum. */
    const planRaw: number[] = [];

    const workouts: WeekBoardWorkout[] = rows.map((row) => {
      const steps = row.detail?.workout.steps ?? [];
      // Named from the structure, the way the book names it (`6 × 800 מ׳`) — the club's own
      // titles are day names (`שלישי`), which the row already says.
      const model = steps.length ? fromLibrarySteps(absoluteToLibrary(steps, referenceSec).steps) : null;
      const graded = boardRow(row, today);
      const { plannedM } = graded;
      const activityId = row.actual?.id ? String(row.actual.id) : null;
      const runLoad = row.completed && activityId ? loadOf.get(activityId) : undefined;
      const planLoad = loadT && steps.length ? plannedLoad(steps, loadT, estimate) : 0;
      planRaw.push(row.detail?.workout.optional ? 0 : planLoad);
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
        plannedSec: graded.plannedSec,
        actualSec: graded.actualSec,
        plannedPace: toTrainee(plannedPace),
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
        ...(row.detail?.workout.optional ? { optional: true } : {}),
      };
    });

    // The week's ⚡: planned = the plan's non-optional sessions summed unrounded and then
    // rounded, exactly as /api/academy/load sums this week's dashed frame, so the tile and
    // the bar print one number. Done = what the matched runs stored.
    const plannedLoadSum = planRaw.reduce((a, b) => a + b, 0);
    const doneLoadSum = workouts.reduce((a, w) => a + (w.load ?? 0), 0);

    const body: WeekBoard = {
      weekStart,
      weekEnd,
      today,
      athlete: { id: athleteId, name: (me.data as { name?: string } | null)?.name ?? report.athletes[0]?.name ?? '' },
      coachName,
      thresholdSec,
      referenceSec,
      fromClub,
      totals: {
        ...weekTotals(workouts.map(w => ({
          completed: w.compliance.color !== 'red' && w.compliance.color !== 'grey',
          plannedM: w.plannedM,
          actualM: w.actualM,
          plannedSec: w.plannedSec,
          actualSec: w.actualSec,
        }))),
        plannedLoad: loadT && plannedLoadSum > 0 ? Math.round(plannedLoadSum) : null,
        doneLoad: loads ? Math.round(doneLoadSum) : null,
      },
      workouts,
      restDays: restDaysOf(weekStart, workouts.map(w => w.date)),
      loadOk: !!loads && loadStatus(loads.rows, today).kind === 'ok',
      // The coach plans from this screen; the trainee only reads it.
      canPlan: caller.athleteId !== athleteId && (caller.isStaff || caller.isSuperUser),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('week-board error:', error);
    return NextResponse.json({ error: 'Failed to load the week' }, { status: 500 });
  }
}
