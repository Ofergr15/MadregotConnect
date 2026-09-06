import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { workoutDistanceMeters } from '@/lib/workout-distance';
import { formatDurationShort, stepDurationSec, workoutDurationSec } from '@/lib/workout-duration';
import { isRestStep, stepMetric, stepQualifier, type StepUnits } from './step-display';
import { groupLadders, workoutSections, type ShapeItem } from './workout-shape';

/**
 * What a session IS, in one word and one line — its type, its main set, and the
 * work that frames it.
 *
 * The Plan tab used to answer all three from the workout's NAME, and this
 * program names its days "יום ראשון", "יום שלישי - בוקר". So Sunday (2 km
 * warmup + 20 km @4:25 + 8 × 15 שנ׳ strides) was labelled "Easy", Friday's
 * ITALIAN MEDIO was labelled "Easy" too, and the headline beside them was
 * whatever the FIRST repeat block in the session happened to be — "8x0:15" for
 * a 23 km long run. A day whose only label is its own name tells the athlete
 * nothing they didn't already know from the row it sits in.
 *
 * Everything here is pure and reads only the steps, so the same three answers
 * are available to the athlete's Plan tab, the dashboard chart and the coach's
 * week card. Unit words are passed in (`StepUnits`) rather than imported from
 * next-intl, same as `stepMetric` — that is what keeps it testable.
 */

/** The seven display types. `rest` is an empty DAY, never a workout. */
export type WorkoutType = 'long_run' | 'intervals' | 'tempo' | 'fartlek' | 'progressive' | 'easy' | 'rest';

/** 20 km — the club's own line between a long run and a normal one. */
const LONG_RUN_METERS = 20000;

/**
 * How much of a session has to be reps before the session IS an interval
 * session. Sunday finishes with 8 × 15 שנ׳ strides: eight minutes of a
 * 107-minute run, which is a detail of a long run and not a rep session, and
 * calling it "Intervals" is how the 23 km long run ended up billed as "8x0:15".
 * Tuesday morning is 70% reps; Tuesday evening (20 × 500 m) is 74%.
 */
const SET_SHARE = 0.25;

/** A block that carries this much of the session is named in the sub-line. */
const FRAME_SHARE = 0.15;

/** How many blocks besides the main set the sub-line will name. */
const MAX_FRAME_ITEMS = 2;

function isWorkStep(step: WorkoutStep): boolean {
  return !!step.repeatCount || step.type === 'interval';
}

/**
 * The type to show for a session.
 *
 * What the coach CALLED it always wins; the shape of the steps only answers
 * when the name is a date, which in this program it is for six days out of
 * seven. "MEDIO" is in the tempo pattern because Friday is written
 * "יום שישי - ITALIAN MEDIO" and nothing else in the session says tempo.
 */
export function classifyWorkout(workout: ParsedWorkout): WorkoutType {
  const text = `${workout.name} ${workout.description || ''}`.toLowerCase();

  if (/fartlek|פרטלק/.test(text)) return 'fartlek';
  if (/long run|ארוכה/.test(text)) return 'long_run';
  if (/interval|אינטרוול|pyramid|פירמידה/.test(text)) return 'intervals';
  if (/tempo|טמפו|medio|מדיו/.test(text)) return 'tempo';
  if (/easy|שחרור|recovery/.test(text)) return 'easy';
  if (/progressive|מתגברת/.test(text)) return 'progressive';

  if (!workout.steps.length) return 'easy';

  const totalSec = workoutDurationSec(workout);
  const workSec = workout.steps.filter(isWorkStep).reduce((sum, s) => sum + stepDurationSec(s), 0);
  if (totalSec > 0 && workSec / totalSec >= SET_SHARE) return 'intervals';

  // Distance LAST, so a 21 km interval session (Tuesday morning) is not filed
  // as a long run just for being long.
  if (workoutDistanceMeters(workout) >= LONG_RUN_METERS) return 'long_run';

  return 'easy';
}

/** The seconds a shape item accounts for — how the main set is chosen. */
function itemSec(item: ShapeItem): number {
  return item.kind === 'ladder'
    ? item.steps.reduce((sum, s) => sum + stepDurationSec(s), 0)
    : stepDurationSec(item.step);
}

/** The leg of a set that the athlete actually runs; the first when there are two. */
function workingLeg(step: WorkoutStep): WorkoutStep {
  const legs = (step.repeatSteps || []).filter((leg) => !isRestStep(leg));
  return legs[0] || (step.repeatSteps || [])[0] || step;
}

/**
 * One block in the notation the program writes it in: `20 × 500 מ׳`,
 * `6 × 9 דק׳`, `3 × (2 × 2 ק״מ)`, `20 ק״מ`, `70–80 דק׳ ריצת שחרור קלה`.
 *
 * The nested count is kept for a ladder of SETS — Tuesday's three 2 × 2 km
 * blocks are three sets of two reps, and "3 × 2 ק״מ" would be half the session.
 */
function itemLabel(item: ShapeItem, units: StepUnits): string {
  if (item.kind === 'ladder') {
    const first = item.steps[0];
    if (first.repeatCount && first.repeatSteps) {
      return `${item.steps.length} × (${first.repeatCount} × ${stepMetric(workingLeg(first), units)})`;
    }
    return `${item.steps.length} × ${stepMetric(first, units)}`;
  }

  const step = item.step;
  if (step.repeatCount && step.repeatSteps) {
    return `${step.repeatCount} × ${stepMetric(workingLeg(step), units)}`;
  }
  // An open step's whole prescription is its note — Monday ("60 דק׳ קל") and
  // Wednesday ("70-80 דק׳ ריצת שחרור קלה") have no metric to lead with at all.
  const metric = stepMetric(step, units);
  const qualifier = stepQualifier(step);
  if (!metric) return qualifier;
  return metric;
}

/** The main section's blocks, biggest first, with recoveries dropped. */
function mainItems(steps: WorkoutStep[]): ShapeItem[] {
  const sections = workoutSections(steps);
  const main = sections.find((s) => s.kind === 'main') || sections[0];
  if (!main) return [];
  return groupLadders(main.steps)
    .filter((item) => item.kind === 'ladder' || !isRestStep(item.step))
    .sort((a, b) => itemSec(b) - itemSec(a));
}

/**
 * The session in one line — the block it is built on.
 *
 * Chosen by TIME, not by position: Sunday's main section is [20 km @4:25,
 * 8 × 15 שנ׳], and the strides come last but take eight minutes against the
 * 20 km's eighty-eight. The old headline took the first repeat block it could
 * find, which is exactly the eight minutes.
 *
 * Empty when the steps carry no metric and no note; the caller falls back to
 * the coach's own name for the session.
 */
export function sessionHeadline(steps: WorkoutStep[], units: StepUnits): string {
  const items = mainItems(steps);
  if (!items.length) return '';
  return itemLabel(items[0], units);
}

/** Distance if the block has a meaningful one, otherwise its clock. */
function sectionMetric(steps: WorkoutStep[], units: StepUnits): string {
  const meters = workoutDistanceMeters({ dayOfWeek: 0, name: '', steps });
  if (meters >= 1000) {
    const km = Math.round(meters / 100) / 10;
    return `${km} ${units.km}`;
  }
  const sec = steps.reduce((sum, s) => sum + stepDurationSec(s), 0);
  return formatDurationShort(sec);
}

export interface FrameLabels extends StepUnits {
  warmup: string;
  cooldown: string;
}

/**
 * What frames the main set: the other sets, then the warm-up and the jog home —
 * `5 × 300 מ׳ · 4 × 45 שנ׳ · חימום 4 ק״מ · שחרור 1 ק״מ`.
 *
 * Filler is left out on purpose. Tuesday morning has a 1 km float in the middle
 * of it at 5:00–5:30; naming it beside the three 2 × 2 km blocks would give a
 * 5% jog the same weight as the session. A plain step earns a mention by being
 * a real slab of the work (Friday's two 5 km at 4:40–5:00 either side of the
 * medio) or by being reps.
 */
export function sessionFrame(steps: WorkoutStep[], labels: FrameLabels): string {
  const sections = workoutSections(steps);
  const items = mainItems(steps);
  const totalSec = steps.reduce((sum, s) => sum + stepDurationSec(s), 0) || 1;

  const parts: string[] = [];
  for (const item of items.slice(1)) {
    const worthNaming = item.kind === 'ladder'
      || isWorkStep(item.step)
      || itemSec(item) / totalSec >= FRAME_SHARE;
    if (!worthNaming) continue;
    const label = itemLabel(item, labels);
    // Friday runs the same 5 km before and after the medio; it is one thing the
    // athlete has to know, not two.
    if (label && !parts.includes(label)) parts.push(label);
    if (parts.length === MAX_FRAME_ITEMS) break;
  }

  const warmup = sections.find((s) => s.kind === 'warmup');
  if (warmup) parts.push(`${labels.warmup} ${sectionMetric(warmup.steps, labels)}`);
  const cooldown = sections.find((s) => s.kind === 'cooldown');
  if (cooldown) parts.push(`${labels.cooldown} ${sectionMetric(cooldown.steps, labels)}`);

  return parts.filter(Boolean).join(' · ');
}
