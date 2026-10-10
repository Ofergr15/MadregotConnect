import type { ParsedWorkout } from '@/lib/ai/types';
import { planWeekStartOf, resolveGroup } from '@/lib/utils';
import { pickPlan } from '@/lib/plans/scope';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { Lane } from './group-lane';
import { plannedLoad, thresholdOn, type TestPoint } from './load';
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

/** Restating paces needs A threshold; with no test, a typical one only sizes the session (week-board's). */
export const DISPLAY_REFERENCE = 300;

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
  const byWeek = new Map<string, { workouts: ParsedWorkout[]; referenceSec: number; drawAtSec: number }>();
  for (const weekStart of weekStarts) {
    const plan = pickPlan(input.planRows.filter(p => String(p.week_start_date).slice(0, 10) === weekStart), athleteId);
    const workouts = plan ? extractWorkouts(plan.parsed_workouts as never, groupNumber) : [];
    planWeeks[weekStart] = workouts.length > 0;
    if (!plan) continue;
    // Whose paces the steps are in — week-board's rule: the trainee's own row is at their
    // own threshold; the club's week at a squad lane's, restated to the trainee's.
    let referenceSec = newest ?? DISPLAY_REFERENCE;
    let drawAtSec = referenceSec;
    if (!plan.athlete_id) {
      const unified = Array.isArray((plan.parsed_workouts as { workouts?: unknown } | null)?.workouts);
      const groupLane = resolveGroup(groupNames.get(input.groupId ?? '') ?? null).index + 1;
      const lane = (unified ? 1 : groupLane >= 1 ? groupLane : 1) as Lane;
      referenceSec = input.laneRefs[lane];
      drawAtSec = newest ?? referenceSec;
    }
    byWeek.set(weekStart, { workouts, referenceSec, drawAtSec });
  }

  const cards: Record<string, TodayCard> = {};
  for (const date of input.dates) {
    const week = byWeek.get(planWeekStartOf(date));
    if (!week) continue;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const workout = mainWorkoutOf(week.workouts.filter(w => w.dayOfWeek === dow));
    if (!workout) continue;
    const T = thresholdOn(date, tests)?.thresholdSec ?? null;
    cards[date] = todayCard(workout, {
      date,
      referenceSec: week.referenceSec,
      drawAtSec: week.drawAtSec,
      onWatch: input.onWatch.has(date),
      expectedLoad: T ? plannedLoad(workout.steps, T, planEstimateOptions(week.workouts)) : null,
      done: input.doneOn(date),
    });
  }
  return { cards, planWeeks };
}
