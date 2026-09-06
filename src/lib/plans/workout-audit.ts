import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { isRestStep, stepQualifier } from './step-display';
import { type EstimateOptions, isEstimate, workoutDistanceEstimate } from './step-estimate';

/**
 * The pre-flight check on one session, run before the coach publishes it.
 *
 * Publishing writes a PNG and a machine-readable text per group per session —
 * twenty-seven artifacts off one PDF — and lands them on sixty phones. Until now
 * the review screen showed the coach a picture of each one and asked them to
 * notice, by eye, that Wednesday has no distance on it, that Tuesday's ❷ pace is
 * FASTER than its ❶, or that a note says "4:50-5:30" beside a pace chip that
 * already says 4:50–5:30. Nobody checks twenty-seven images that way, so nobody
 * checked at all.
 *
 * Every finding here is a thing the coach can act on, computed off the steps.
 * Deliberately NOT a validator: nothing it says blocks publishing, because the
 * coach is the authority on their own program and "no distance" is sometimes
 * exactly what they meant to write. It's a second pair of eyes, not a gate.
 *
 * Codes and counts come out; words stay in the component (messages/*.json),
 * same rule as `step-display` — that is what keeps this unit-tested.
 */

export type AuditLevel = 'warn' | 'info';

export type AuditCode =
  /** Nothing in the session says how far it is. */
  | 'noDistance'
  /** It has a distance, but one this app multiplied out of a time and a pace. */
  | 'estimatedDistance'
  /** Run steps carrying neither a pace nor a word about how to run them. */
  | 'unpacedSteps'
  /** ❶ is meant to be the fastest group and ❸ the slowest; here it isn't. */
  | 'paceInversion'
  /** Notes that only restate the pace or the metric already on the row. */
  | 'duplicateNotes'
  /** Steps where the three groups really do run different paces. */
  | 'groupPacesDiffer'
  /** Not one step differs between the groups — all three get the same board. */
  | 'groupPacesIdentical'
  /** One step and no structure: whatever the coach wrote is all there is. */
  | 'singleStep';

export interface AuditFinding {
  code: AuditCode;
  level: AuditLevel;
  /** How many steps it is about; 1 for a finding about the whole session. */
  count: number;
  /** `step.order` of each step involved, so the screen can point at them. */
  steps: number[];
}

/** Warnings before observations, and a fixed order inside each. */
const CODE_ORDER: AuditCode[] = [
  'noDistance',
  'paceInversion',
  'unpacedSteps',
  'estimatedDistance',
  'duplicateNotes',
  'groupPacesDiffer',
  'groupPacesIdentical',
  'singleStep',
];

const WARN: AuditCode[] = ['noDistance', 'paceInversion', 'unpacedSteps'];

/**
 * The steps an athlete actually runs — a repeat block's legs stand in for the
 * block, since the wrapper is a container and has no pace of its own.
 */
function legSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps?.length) {
      out.push(...legSteps(step.repeatSteps));
      continue;
    }
    out.push(step);
  }
  return out;
}

/** Every step, containers included — a wrapper can still carry a note. */
function allSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.repeatSteps?.length) out.push(...allSteps(step.repeatSteps));
  }
  return out;
}

/** The three groups' faster bound, in group order; null where a group has none. */
function groupMins(step: WorkoutStep): [number | null, number | null, number | null] {
  return [
    step.targetPaceMinPerKm ?? null,
    step.group2Pace?.min ?? null,
    step.group3Pace?.min ?? null,
  ];
}

/**
 * True when ❶ → ❷ → ❸ get slower, as the club writes them. Groups without a
 * pace are skipped rather than treated as zero — a step where only ❷ is set is
 * not an inversion, it is a step with one pace on it.
 */
function pacesOrdered(step: WorkoutStep): boolean {
  const set = groupMins(step).filter((p): p is number => p != null);
  return set.every((pace, i) => i === 0 || set[i - 1] <= pace);
}

function pacesDiffer(step: WorkoutStep): boolean {
  const set = groupMins(step).filter((p): p is number => p != null);
  return new Set(set).size > 1;
}

/** A step the athlete runs, as opposed to a recovery or an empty container. */
function isRunStep(step: WorkoutStep): boolean {
  if (isRestStep(step)) return false;
  return !(step.repeatCount && step.repeatSteps?.length);
}

/**
 * Everything worth saying about one session, most serious first.
 *
 * `opts` is the week's own pace band (`planEstimateOptions`) — the same one the
 * distances on screen are figured with, so a session the screen shows as an
 * estimate is the session this reports as one.
 */
export function auditWorkout(workout: ParsedWorkout, opts?: EstimateOptions): AuditFinding[] {
  const found: AuditFinding[] = [];
  const add = (code: AuditCode, steps: number[]) => {
    found.push({
      code,
      level: WARN.includes(code) ? 'warn' : 'info',
      count: steps.length || 1,
      steps,
    });
  };

  const steps = workout.steps || [];
  const legs = legSteps(steps);

  // Strict on purpose: `assumeOpenBlocks` would credit an information-free
  // warmup with a nominal 2 km, and a session that only LOOKS like it has a
  // distance is the thing this finding exists to catch.
  const distance = workoutDistanceEstimate(workout, opts);
  if (distance.from === 'none' || distance.range.max === 0) add('noDistance', []);
  else if (isEstimate(distance.from)) add('estimatedDistance', []);

  const inverted = legs.filter((s) => !pacesOrdered(s));
  if (inverted.length) add('paceInversion', inverted.map((s) => s.order));

  const unpaced = legs.filter((s) => isRunStep(s) && !s.targetPaceMinPerKm && !stepQualifier(s));
  if (unpaced.length) add('unpacedSteps', unpaced.map((s) => s.order));

  // `stepQualifier` is what the row already prints; a note it empties out is a
  // note whose entire content is the pace and the minutes beside it.
  const echoes = allSteps(steps).filter((s) => (s.notes || '').trim() && !stepQualifier(s));
  if (echoes.length) add('duplicateNotes', echoes.map((s) => s.order));

  const differing = legs.filter(pacesDiffer);
  if (differing.length) add('groupPacesDiffer', differing.map((s) => s.order));
  else if (legs.some((s) => s.targetPaceMinPerKm)) add('groupPacesIdentical', []);

  if (steps.length === 1 && !steps[0].repeatCount) add('singleStep', []);

  return found.sort((a, b) => CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code));
}

/** How many of the findings are warnings — the number the review chip shows. */
export function countWarnings(findings: AuditFinding[]): number {
  return findings.filter((f) => f.level === 'warn').length;
}

export interface WeekAudit {
  /** Findings per session, keyed by the same key `WeekSession.key` uses. */
  byKey: Record<string, AuditFinding[]>;
  /** Sessions with at least one warning — what the hero counts. */
  sessionsWithWarnings: number;
  /** Steps across the week whose groups really do run different paces. */
  differingPaceSteps: number;
}

/**
 * The whole week audited in one pass, so the hero's counts and each session's
 * chip are the same numbers rather than two functions that agree today.
 */
export function auditWeek(workouts: ParsedWorkout[], opts?: EstimateOptions): WeekAudit {
  const byKey: Record<string, AuditFinding[]> = {};
  let sessionsWithWarnings = 0;
  let differingPaceSteps = 0;

  workouts.forEach((w, i) => {
    const findings = auditWorkout(w, opts);
    byKey[w.workoutKey || `day-${w.dayOfWeek}-part-${w.partIndex ?? i + 1}`] = findings;
    if (countWarnings(findings)) sessionsWithWarnings++;
    differingPaceSteps += findings.find((f) => f.code === 'groupPacesDiffer')?.count || 0;
  });

  return { byKey, sessionsWithWarnings, differingPaceSteps };
}
