import type { WorkoutStep } from '@/lib/ai/types';
import { stepPaceTokens, joinGroupPaces } from '@/lib/garmin/pace';
import { stepDurationSec } from '@/lib/workout-duration';
import { isRestStep, stepQualifier } from './step-display';

/**
 * The SHAPE of a workout — how its steps group into sections and sets — as
 * opposed to how a single step is worded (step-display.ts) or how long it takes
 * (workout-duration.ts).
 *
 * This exists because the week card had a hard cap of three visible steps, and
 * Tuesday morning is fifteen. Twelve of them sat behind a "+12 more" button, so
 * the day with the most in it showed the least. Raising the cap alone isn't the
 * answer either: fifteen flat rows in a 7-column week is a wall.
 *
 * So the card is built the way the program is written:
 *   · warmup / main / cooldown, because a warmup is not a set;
 *   · consecutive sets of the SAME shape that differ only in pace become one
 *     line with a pace ladder — Tuesday's "45s @3:50, 45s @3:40, 45s @3:30,
 *     45s @3:20" is one instruction, not four, and so are the three 2 × 2 km
 *     blocks at 3:35 / 3:30 / 3:25 that follow it.
 *
 * Nothing is hidden by any of it: every step is on the card, and a merge that
 * would drop information (a set with two working legs, a step carrying ❷/❸
 * paces) is refused.
 */

export type SectionKind = 'warmup' | 'main' | 'cooldown';

export interface WorkoutSection {
  kind: SectionKind;
  steps: WorkoutStep[];
}

/** 4:40/km or slower, over a short distance, at the end of a session — a jog home. */
const COOLDOWN_PACE_FLOOR = 280;
const COOLDOWN_MAX_METERS = 2000;

function isCooldownish(step: WorkoutStep): boolean {
  if (step.type === 'cooldown' || step.type === 'recovery') return true;
  return step.type === 'active'
    && step.durationType === 'distance'
    && !!step.durationValue
    && step.durationValue <= COOLDOWN_MAX_METERS
    && (step.targetPaceMinPerKm || 0) >= COOLDOWN_PACE_FLOOR;
}

/**
 * A LEADING run of warmups and a TRAILING run of easy work; everything between
 * them is the session.
 *
 * Deliberately positional. Labelling each step from its own type instead made the
 * headings flip-flop — warmup / main / cooldown / main / cooldown — every time a
 * walk recovery appeared mid-session, which on an interval day is constantly.
 */
export function workoutSections(steps: WorkoutStep[]): WorkoutSection[] {
  let start = 0;
  while (start < steps.length && steps[start].type === 'warmup') start++;
  let end = steps.length;
  while (end > start && isCooldownish(steps[end - 1])) end--;

  const sections: WorkoutSection[] = [
    { kind: 'warmup', steps: steps.slice(0, start) },
    { kind: 'main', steps: steps.slice(start, end) },
    { kind: 'cooldown', steps: steps.slice(end) },
  ];
  return sections.filter((section) => section.steps.length > 0);
}

export type ShapeItem =
  | { kind: 'step'; step: WorkoutStep }
  | { kind: 'ladder'; steps: WorkoutStep[] };

/** Fewer than three in a row is just repetition; it isn't a ladder worth naming. */
const MIN_LADDER = 3;

/**
 * The one leg of a step that carries the pace: the step itself, or the single
 * working leg of a set.
 *
 * Null when a set has none or several — Thursday's 6 × (9 דק׳ @4:25 + 1 דק׳
 * @3:40) has two, and there is no honest single pace to put on a rung for it.
 */
export function paceCarrier(step: WorkoutStep): WorkoutStep | null {
  if (!step.repeatSteps || !step.repeatCount) return step;
  const working = step.repeatSteps.filter((leg) => !isRestStep(leg));
  return working.length === 1 ? working[0] : null;
}

/** The pace as one string, all groups included — what a rung shows. */
export function stepPaceLabel(step: WorkoutStep): string {
  return joinGroupPaces(stepPaceTokens(step));
}

function hasOtherGroupPaces(step: WorkoutStep): boolean {
  if (step.group2Pace || step.group3Pace) return true;
  return (step.repeatSteps || []).some((leg) => leg.group2Pace || leg.group3Pace);
}

/**
 * The structure of a step with its paces removed — two steps with the same key
 * are the same instruction run at different speeds.
 */
function ladderKey(step: WorkoutStep): string | null {
  // A step whose ❷/❸ paces would have to be squeezed onto a rung is left alone;
  // the club notation "3:30 (3:40) ((3:50))" doesn't survive being stacked four
  // across, and losing ❷/❸ is exactly the kind of quiet omission this whole
  // change is undoing.
  if (hasOtherGroupPaces(step)) return null;
  if (!paceCarrier(step)) return null;

  if (step.repeatCount && step.repeatSteps) {
    const legs = step.repeatSteps
      .map((leg) => `${leg.type}:${leg.durationType}:${leg.durationValue ?? ''}:${stepQualifier(leg)}`)
      .join('+');
    return `r${step.repeatCount}|${legs}`;
  }

  if (!step.durationValue) return null;
  if (step.type !== 'interval' && step.type !== 'active') return null;
  return `s|${step.type}:${step.durationType}:${step.durationValue}:${stepQualifier(step)}`;
}

/** Steps in order, with runs of same-shape sets collapsed into one ladder item. */
export function groupLadders(steps: WorkoutStep[]): ShapeItem[] {
  const items: ShapeItem[] = [];
  let run: WorkoutStep[] = [];

  const flush = () => {
    if (run.length >= MIN_LADDER) items.push({ kind: 'ladder', steps: run });
    else for (const step of run) items.push({ kind: 'step', step });
    run = [];
  };

  for (const step of steps) {
    const key = ladderKey(step);
    if (key && run.length && ladderKey(run[0]) === key) {
      run.push(step);
      continue;
    }
    flush();
    if (key) run = [step];
    else items.push({ kind: 'step', step });
  }
  flush();

  return items;
}

/** The rung labels of a ladder, in order. */
export function ladderPaces(steps: WorkoutStep[]): string[] {
  return steps.map((step) => {
    const carrier = paceCarrier(step);
    return carrier ? stepPaceLabel(carrier) : '';
  });
}

/**
 * True when the rungs actually climb — more than one distinct pace. Three
 * identical sets in a row are "3 ×", not a ladder, and calling them one would be
 * telling the athlete something the program doesn't say.
 */
export function isPaceLadder(steps: WorkoutStep[]): boolean {
  return new Set(ladderPaces(steps).filter(Boolean)).size > 1;
}

export interface ProfileSegment {
  /** Step type, for the colour. */
  type: string;
  /** Seconds — the segment's width is its share of the session. */
  sec: number;
}

/**
 * Past this many segments the bar stops being a shape and becomes a hatch
 * pattern, so a set is drawn as one segment per leg instead of one per
 * repetition. Tuesday evening's 20 × (500 m + 60 s jog) is why.
 */
const MAX_PROFILE_SEGMENTS = 32;

/**
 * The session's shape as a row of proportional blocks — warmup, work, recovery,
 * jog home — so a glance says "long steady" or "eight hard reps" before a single
 * number is read.
 */
export function profileSegments(steps: WorkoutStep[]): ProfileSegment[] {
  const perRepetition: ProfileSegment[] = [];
  const perLeg: ProfileSegment[] = [];

  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      for (let i = 0; i < step.repeatCount; i++) {
        for (const leg of step.repeatSteps) {
          perRepetition.push({ type: leg.type, sec: stepDurationSec(leg) });
        }
      }
      for (const leg of step.repeatSteps) {
        perLeg.push({ type: leg.type, sec: stepDurationSec(leg) * step.repeatCount });
      }
      continue;
    }
    const segment = { type: step.type, sec: stepDurationSec(step) };
    perRepetition.push(segment);
    perLeg.push(segment);
  }

  const chosen = perRepetition.length > MAX_PROFILE_SEGMENTS ? perLeg : perRepetition;
  return chosen.filter((segment) => segment.sec > 0);
}

/**
 * How many sets the session has, counted off the SAME grouping the card draws —
 * a ladder is one set, a repeat block is one set — so the footer can never
 * disagree with the rows above it.
 */
export function countSets(steps: WorkoutStep[]): number {
  let sets = 0;
  for (const item of groupLadders(steps)) {
    if (item.kind === 'ladder') sets++;
    else if (item.step.repeatCount || item.step.type === 'interval') sets++;
  }
  return sets;
}
