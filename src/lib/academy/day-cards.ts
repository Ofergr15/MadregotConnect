import type { ParsedWorkout } from '@/lib/ai/types';
import { planWeekStartOf } from '@/lib/utils';
import { pickPlan } from '@/lib/plans/scope';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { Lane } from './group-lane';
import { plannedLoad, restateOptions, restateSteps, thresholdOn, type TestPoint } from './load';
import { DISPLAY_REFERENCE, planPaceBasis } from './plan-basis';
import { extractWorkouts, groupNumberFor } from './report';
import { mainWorkoutOf, todayCard, type TodayCard } from './trainee-today';

/**
 * A trainee's planned day as the card the home draws (lib/academy/trainee-today.ts
 * `todayCard`), for a few dates at once — shared by GET /api/academy/today and the morning
 * reminder (morning-reminder-server.ts), so the push says exactly what the home shows.
 *
 * WHOSE PLAN: per week the trainee's OWN weekly_plans row, else the club's group plan in
 * their group's variant, never another trainee's (`pickPlan`, lib/plans/scope.ts). `planRows`
 * are what `planRowsFilter(athleteId)` returned for the weeks involved.
 */

export { DISPLAY_REFERENCE };

export interface DayCardsInput {
  dates: string[];
  athleteId: string;
  groupId: string | null;
  planRows: Array<{ week_start_date: string; parsed_workouts: unknown; athlete_id: string | null; created_at?: string }>;
  groupNames: Map<string, string>;
  laneRefs: Record<Lane, number>;
  /** Usable tests, oldest first (loadTestsFor). */
  tests: TestPoint[];
  /** Dates whose workout is on the watch. */
  onWatch: Set<string>;
  /** A run is already in on this date. */
  doneOn: (date: string) => boolean;
}

export function dayCards(input: DayCardsInput): { cards: Record<string, TodayCard>; planWeeks: Record<string, boolean> } {
  const { athleteId, groupNames, tests } = input;
  const groupNumber = groupNumberFor(input.groupId, groupNames);
  const newest = tests.length ? tests[tests.length - 1].thresholdSec : null;
  const weekStarts = [...new Set(input.dates.map(d => planWeekStartOf(d)))];

  const planWeeks: Record<string, boolean> = {};
  const byWeek = new Map<string, { workouts: ParsedWorkout[]; referenceSec: number; drawAtSec: number; scale: number }>();
  for (const weekStart of weekStarts) {
    const plan = pickPlan(input.planRows.filter(p => String(p.week_start_date).slice(0, 10) === weekStart), athleteId);
    const workouts = plan ? extractWorkouts(plan.parsed_workouts as never, groupNumber) : [];
    planWeeks[weekStart] = workouts.length > 0;
    if (!plan) continue;
    // Whose paces the steps are in (lib/academy/plan-basis.ts): the trainee's own row is at
    // their own threshold; the club's week at a squad lane's, restated to the trainee's.
    const basis = planPaceBasis({
      planAthleteId: plan.athlete_id,
      parsedWorkouts: plan.parsed_workouts,
      groupName: groupNames.get(input.groupId ?? '') ?? null,
      laneRefs: input.laneRefs,
      thresholdSec: newest,
    });
    byWeek.set(weekStart, { workouts, referenceSec: basis.referenceSec, drawAtSec: basis.drawAtSec, scale: basis.scale });
  }

  const cards: Record<string, TodayCard> = {};
  for (const date of input.dates) {
    const week = byWeek.get(planWeekStartOf(date));
    if (!week) continue;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const workout = mainWorkoutOf(week.workouts.filter(w => w.dayOfWeek === dow));
    if (!workout) continue;
    const T = thresholdOn(date, tests)?.thresholdSec ?? null;
    // Priced in the trainee's paces, over the same legs (a repeat's last jog is between the
    // reps, as the card's bar draws it), so "כ־51 דק׳" and "⚡ 62" count the same session.
    const steps = restateSteps(workout.steps, week.scale);
    const opts = restateOptions(planEstimateOptions(week.workouts), week.scale);
    cards[date] = todayCard(workout, {
      date,
      referenceSec: week.referenceSec,
      drawAtSec: week.drawAtSec,
      onWatch: input.onWatch.has(date),
      expectedLoad: T ? plannedLoad(steps, T, opts) : null,
      done: input.doneOn(date),
    });
  }
  return { cards, planWeeks };
}
