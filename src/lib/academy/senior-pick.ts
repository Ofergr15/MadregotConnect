/**
 * "מה שהבוגרת רצה בשלישי" — the senior groups' session for a trainee's day, at the
 * trainee's own pace.
 *
 * The club's weekly plan (`weekly_plans` with `athlete_id IS NULL`) is the senior groups'
 * plan: one row per Sunday week, three pace lanes (see group-lane.ts). On most days the
 * best workout for an academy trainee is the one the club is running, so screen 1 opens
 * on it, large, with one button. This file decides WHICH workout and what it becomes.
 *
 * ── The lane's reference threshold ───────────────────────────────────────────────────────
 *
 * A lane's paces are absolute — written for a squad, not for this trainee. To move them to
 * the trainee they are first stated relative to the threshold they were written FOR, and
 * then resolved against the trainee's own. The squads are named by their marathon goal
 * (`SUB 2:30`, `SUB 2:35`, `SUB 2:45`, the aliases `resolveGroup` already maps onto lanes
 * 1-3), so the reference is that goal's marathon pace stated as a threshold: marathon pace
 * is 95% of threshold speed, the centre of `ZONE_INTENSITY.marathon_pace` — the app's own
 * table, which is the point: a lane step written at the squad's marathon pace resolves to
 * the trainee's marathon pace by the same table the book prices everything with.
 *
 * Not the week's own "threshold" steps: most weeks have none, and a reference that moved
 * week to week would give the same session different paces each time it came round.
 */

import type { ParsedWorkout } from '@/lib/ai/types';
import { ZONE_INTENSITY } from './library';
import { laneWorkouts, type Lane } from './group-lane';
import { absoluteToLibrary, bookTotals, centrePct, fromLibrarySteps, structureName, toneOf, type BookStep } from './book-steps';

/** From here an easy run is the long run, and is listed. */
const LONG_RUN_M = 14000;
import type { LibraryStep } from './library';

/** Each lane's marathon goal when no group name says otherwise: the club's three squads. */
export const DEFAULT_LANE_GOAL_SEC: Record<Lane, number> = {
  1: 2 * 3600 + 30 * 60,
  2: 2 * 3600 + 35 * 60,
  3: 2 * 3600 + 45 * 60,
};

const MARATHON_KM = 42.195;

/** `"Group A - SUB 2:30"` → 9000. Null when the name carries no goal. */
export function goalFromGroupName(name: string | null | undefined): number | null {
  const m = (name ?? '').match(/sub\s*(\d):(\d{2})/i);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

/** A marathon goal → the threshold pace (sec/km) the squad's paces were written for. */
export function referenceFromGoal(goalSec: number): number {
  const marathonPace = goalSec / MARATHON_KM;
  return Math.round(marathonPace * (centrePct(ZONE_INTENSITY.marathon_pace!) / 100));
}

/**
 * The three lanes' reference thresholds, from the club's groups when they name a goal.
 * `groups` are `{ name, lane }` with `lane` from `resolveGroup(name).index + 1`.
 */
export function laneReferences(groups: Array<{ name: string | null; lane: Lane | null }> = []): Record<Lane, number> {
  const out = {
    1: referenceFromGoal(DEFAULT_LANE_GOAL_SEC[1]),
    2: referenceFromGoal(DEFAULT_LANE_GOAL_SEC[2]),
    3: referenceFromGoal(DEFAULT_LANE_GOAL_SEC[3]),
  } as Record<Lane, number>;
  for (const g of groups) {
    const goal = goalFromGroupName(g.name);
    if (g.lane && goal) out[g.lane] = referenceFromGoal(goal);
  }
  return out;
}

export interface SeniorWorkout {
  dayOfWeek: number;
  /** The club's own title for the day, kept for the source line. */
  clubName: string;
  /** The session as the book stores it: relative to the lane's reference. */
  steps: LibraryStep[];
  /** The editable model, or null when the session is richer than the adjust screen draws. */
  model: BookStep[] | null;
  /** A name from the structure (`5 × 1 ק״מ`), which is what a coach recognises it by. */
  name: string;
  /** The coach's note on the day, paces stripped. */
  notes: string | null;
  review: string[];
}

/** A club workout → a book-shaped one, relative to `referenceSec`. */
export function seniorFromWorkout(workout: ParsedWorkout, referenceSec: number): SeniorWorkout {
  const { steps, review } = absoluteToLibrary(workout.steps ?? [], referenceSec);
  const model = fromLibrarySteps(steps);
  const description = workout.description?.replace(/\d{1,2}:\d{2}/g, '').trim() || null;
  return {
    dayOfWeek: workout.dayOfWeek,
    clubName: workout.name,
    steps,
    model,
    name: model ? structureName(model) : workout.name,
    notes: description,
    review,
  };
}

/** True when a session is just easy running — not worth a row of its own in "the week". */
function isEasyDay(w: SeniorWorkout): boolean {
  if (!w.model) return false;
  const allEasy = w.model.every(s => s.kind === 'rest' || ((s.kind === 'run' || s.kind === 'reps') && toneOf(s.effort) === 'e'));
  // A long run is easy running too, and it is the week's most important session.
  return allEasy && bookTotals(w.model, null).distanceM < LONG_RUN_M;
}

export interface SeniorPick {
  lane: Lane;
  /** The session on the trainee's day, or null when the club rests (or has no plan). */
  today: SeniorWorkout | null;
  /** The week's other quality sessions, by day — at most three. */
  others: SeniorWorkout[];
}

/**
 * The pick for one day.
 *
 * A two-part day (warmup / test / main written as separate parts, or a morning and an
 * evening) takes its first non-optional MAIN part: that is the session, and the optional
 * evening run is not what the trainee should be given in its place. Easy days are left out
 * of `others` — the list exists to offer the week's other real sessions, and four rows of
 * `8 ק״מ קל` would push them off the screen.
 */
export function pickSeniorDay(parsed: unknown, lane: Lane, dayOfWeek: number, referenceSec: number): SeniorPick {
  const workouts = laneWorkouts(parsed, lane).filter(w => Array.isArray(w?.steps) && w.steps.length > 0);
  const byDay = new Map<number, ParsedWorkout[]>();
  for (const w of workouts) {
    if (typeof w.dayOfWeek !== 'number') continue;
    byDay.set(w.dayOfWeek, [...(byDay.get(w.dayOfWeek) ?? []), w]);
  }
  const mainOf = (list: ParsedWorkout[]): ParsedWorkout | null => {
    const prescribed = list.filter(w => !w.optional);
    const pool = prescribed.length ? prescribed : list;
    return pool.find(w => w.partKind === 'main' || w.partKind === 'single' || !w.partKind)
      ?? pool.find(w => w.partKind === 'morning')
      ?? pool[0] ?? null;
  };

  const todayRaw = mainOf(byDay.get(dayOfWeek) ?? []);
  const today = todayRaw ? seniorFromWorkout(todayRaw, referenceSec) : null;
  const others = [...byDay.entries()]
    .filter(([day]) => day !== dayOfWeek)
    .sort(([a], [b]) => a - b)
    .map(([, list]) => mainOf(list))
    .filter((w): w is ParsedWorkout => !!w)
    .map(w => seniorFromWorkout(w, referenceSec))
    .filter(w => !isEasyDay(w))
    .slice(0, 3);
  return { lane, today, others };
}
