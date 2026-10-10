import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { addDaysToDateStr, israelToday, planWeekStartOf, resolveGroup } from '@/lib/utils';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { loadClubWeek, loadLaneReferences, loadThresholds, loadTraineeWeeks } from '@/lib/academy/book-server';
import type { Lane } from '@/lib/academy/group-lane';
import { computeAcademyWeekAdherence } from '@/lib/academy/report';
import { complianceOf, weekTotals } from '@/lib/academy/compliance';
import { absoluteToLibrary, fromLibrarySteps, structureName } from '@/lib/academy/book-steps';
import type { WeekBoard, WeekBoardWorkout } from '@/lib/academy/week-board';

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
 * plan-vs-actual sheet use, so the strip cannot disagree with the sheet it opens.
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
    const [report, deliveries, me, thresholds] = await Promise.all([
      computeAcademyWeekAdherence({ weekStart, onlyAthleteId: athleteId, keepDetail: true }),
      supabase
        .from('workout_deliveries')
        .select('workout_date, status')
        .eq('athlete_id', athleteId)
        .gte('workout_date', weekStart)
        .lte('workout_date', weekEnd),
      supabase.from('athletes').select('id, name, academy_coach_id').eq('id', athleteId).maybeSingle(),
      loadThresholds(supabase, [athleteId]),
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
    const today = israelToday();
    const rows = report.athletes[0]?.week.workouts ?? [];

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

    const workouts: WeekBoardWorkout[] = rows.map((row) => {
      const steps = row.detail?.workout.steps ?? [];
      // Named from the structure, the way the book names it (`6 × 800 מ׳`) — the club's own
      // titles are day names (`שלישי`), which the row already says.
      const model = steps.length ? fromLibrarySteps(absoluteToLibrary(steps, referenceSec).steps) : null;
      const plannedM = (row.distance.plannedMin + row.distance.plannedMax) / 2 || null;
      const plannedPace = row.pace.plannedMin && row.pace.plannedMax
        ? Math.round((row.pace.plannedMin + row.pace.plannedMax) / 2)
        : null;
      return {
        date: row.date,
        dayOfWeek: new Date(`${row.date}T12:00:00Z`).getUTCDay(),
        name: model ? structureName(model) : row.name,
        compliance: complianceOf({
          date: row.date,
          today,
          completed: row.completed,
          plannedM,
          actualM: row.distance.actual,
          plannedSec: row.duration.planned || null,
          actualSec: row.duration.actual,
          plannedInTime: !row.duration.estimated && !(plannedM && plannedM > 0),
        }),
        plannedM,
        actualM: row.distance.actual,
        plannedSec: row.duration.planned || null,
        actualSec: row.duration.actual,
        plannedPace: toTrainee(plannedPace),
        // The work's pace where the reps were read; the whole run's only when the session
        // was graded against a whole-session band — never a run average set beside a rep
        // target, which would call every interval session slow.
        actualPace: workPaceOfRow(row) ?? (row.pace.comparedMin != null && row.pace.comparedMin === row.pace.plannedMin ? row.pace.actual : null),
        onWatch: onWatch.has(row.date),
        steps,
        note: row.detail?.workout.description ?? null,
        activityId: row.actual?.id ? String(row.actual.id) : null,
      };
    });

    const body: WeekBoard = {
      weekStart,
      weekEnd,
      today,
      athlete: { id: athleteId, name: (me.data as { name?: string } | null)?.name ?? report.athletes[0]?.name ?? '' },
      coachName,
      thresholdSec,
      referenceSec,
      fromClub,
      totals: weekTotals(workouts.map(w => ({
        completed: w.compliance.color !== 'red' && w.compliance.color !== 'grey',
        plannedM: w.plannedM,
        actualM: w.actualM,
        plannedSec: w.plannedSec,
        actualSec: w.actualSec,
      }))),
      workouts,
      // The coach plans from this screen; the trainee only reads it.
      canPlan: caller.athleteId !== athleteId && (caller.isStaff || caller.isSuperUser),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('week-board error:', error);
    return NextResponse.json({ error: 'Failed to load the week' }, { status: 500 });
  }
}
