import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { isAcademyOnly } from '@/lib/plans/scope';
import { isManualPlan } from '@/lib/plans/scope-server';
import { planDayKey } from '@/lib/plans/workout-parsing';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { pushWeekToAthlete } from '@/lib/garmin/push-week';
import { planWeekStartOf } from '@/lib/utils';
import type { ParsedWorkout } from '@/lib/ai/types';

// "שלח שוב לשעון": ONE day of the caller's own plan back onto their own Garmin watch.
// Same plan resolution as lib/watch/own-week.ts (club week, or a week written for this
// runner), plus the trainee's individual academy week, which wins over the club's —
// and which alone carries pace-zone alarms (paceTarget per is_academy, exactly the
// rule in POST /api/garmin/push-workouts: never on the club's week).
//
// ⚠️ No authorization here: the caller passes an athlete id taken from the session.

type Db = ReturnType<typeof createServerClient>;
type PlanRow = { id: string; parsed_workouts: unknown; status?: string; athlete_id?: string | null };

export type ResendDayResult =
  | { status: 'ok'; sent: number }
  | { status: 'garmin-not-connected' | 'no-workout' }
  | { status: 'failed'; error: string };

export async function resendOwnDay(athleteId: string, date: string, supabase: Db = createServerClient()): Promise<ResendDayResult> {
  const weekStartDate = planWeekStartOf(date);
  const [{ data: athlete }, { data: clubRow }, { data: ownRows }] = await Promise.all([
    supabase.from('athletes')
      .select('id, name, garmin_auth, is_academy, group_id, groups!group_id(pace_profile)')
      .eq('id', athleteId).maybeSingle(),
    supabase.from('weekly_plans').select('id, parsed_workouts, status, athlete_id')
      .eq('coach_id', COACH_ID).eq('week_start_date', weekStartDate).is('athlete_id', null)
      .order('status', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('weekly_plans').select('id, parsed_workouts, status, athlete_id')
      .eq('week_start_date', weekStartDate).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false }),
  ]);
  if (!athlete?.garmin_auth) return { status: 'garmin-not-connected' };

  // Only rows that really are this athlete's (defence in depth against a loose filter).
  const own = ((ownRows || []) as PlanRow[]).filter((p) => p.athlete_id === athleteId);
  const manual = own.find(isManualPlan);
  const individual = own.find((p) => !isManualPlan(p)) || null;
  const club = isAcademyOnly(athlete as { is_academy?: boolean | null; group_id?: string | null }) ? null : (clubRow as PlanRow | null);
  // Trainee's individual academy week > a hand-written week > the club's.
  const plan = (athlete.is_academy && individual) || manual || club;
  if (!plan?.parsed_workouts) return { status: 'no-workout' };

  const { data: groups } = await supabase.from('groups').select('id, pace_profile').eq('coach_id', COACH_ID);
  const groupKey = paceGroupKeyFor(
    ((groups || []) as Array<{ id: string; pace_profile: { marathonGoal?: number | null } | null }>).map((g) => ({
      id: g.id, marathonGoal: g.pace_profile?.marathonGoal ?? null,
    })),
    (athlete as { group_id?: string | null }).group_id,
  );
  const parsed = plan.parsed_workouts as Record<string, { workouts?: ParsedWorkout[] }> & { workouts?: ParsedWorkout[] };
  const variant = parsed[groupKey]?.workouts || parsed.workouts || [];
  const week = withGroupPaces(normalizeWorkoutParts({ workouts: variant }).workouts, plan.parsed_workouts);
  // A plan day is a dayOfWeek: turn it into a date and compare dates (CLAUDE.md, week anchors).
  const day = week.filter((w) => typeof w.dayOfWeek === 'number' && planDayKey(weekStartDate, w.dayOfWeek) === date);
  if (!day.length) return { status: 'no-workout' };

  const individualWeek = plan === individual;
  const result = await pushWeekToAthlete({
    supabase, athlete: athlete as never, plannedWorkouts: day, weekStartDate, planId: plan.id,
    paceTarget: individualWeek && !!athlete.is_academy,
    notify: false, // they are holding the phone that just did it
    cleanDayOnce: true,
  });
  if (result.status === 'failed') return { status: 'failed', error: result.error || 'push-failed' };
  return { status: 'ok', sent: day.length };
}
