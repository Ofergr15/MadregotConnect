import { createHash } from 'crypto';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import type { StoredPaceProfile } from '@/lib/garmin/types';
import { getPaceForZone } from '@/lib/garmin/pace';
import { buildStepDescription } from '@/lib/garmin/converter';

/**
 * ParsedWorkout → WatchWorkoutV1: the provider-neutral, already-flattened shape
 * the iPhone app turns into a WorkoutKit `CustomWorkout`.
 *
 * WorkoutKit is stricter than our model, and every rule below exists because of
 * one of its limits (WWDC23 10016, WorkoutKit reference):
 *   - ONE warmup and ONE cooldown, each a single `WorkoutStep`;
 *   - blocks of `IntervalStep`s with an iteration count, and no nesting;
 *   - one goal and ONE alert per step (warmup/cooldown included);
 *   - pace is a speed (`UnitSpeed`), HR an absolute rate — no "% of max";
 *   - text on a step (`displayName`) only from iOS 18 / watchOS 11.
 *
 * So all the shape work happens HERE, once, tested — the Swift side only maps
 * fields 1:1 and validates with `CustomWorkout.supportsGoal/supportsAlert`.
 *
 * Pure: no I/O. Resolved per athlete at push time (their variant's paces, their
 * group's profile, their max HR), exactly like the Garmin converter, and frozen
 * into the delivery row so a later plan edit is a NEW delivery, not a silent
 * change to something already on a wrist.
 *
 * The Garmin converter is deliberately NOT rebuilt on top of this. It stays the
 * code that has been on athletes' watches all season; the only thing shared is
 * its step-text rule (`buildStepDescription`), so the words on an Apple Watch
 * and a Garmin are the same words.
 */

export const WATCH_WORKOUT_SCHEMA = 'madregot.watch-workout' as const;
export const WATCH_WORKOUT_VERSION = 1 as const;

/** Undocumented on Apple's side; long names are cut here rather than by the watch. */
export const MAX_DISPLAY_NAME = 80;
/** Half-width of the band a single pace becomes when it has to alert. */
export const SINGLE_PACE_TOLERANCE_SEC = 5;

export type WatchGoalV1 =
  | { type: 'open' }
  | { type: 'distance'; meters: number }
  | { type: 'time'; seconds: number };

export type WatchAlertV1 =
  | { type: 'speedRange'; minMps: number; maxMps: number; metric: 'current' }
  | { type: 'heartRateRange'; minBpm: number; maxBpm: number };

export interface WatchStepTargetV1 {
  pace?: { minSecPerKm: number; maxSecPerKm: number };
  heartRate?: { minPct: number; maxPct: number; minBpm: number | null; maxBpm: number | null };
}

export interface WatchStepV1 {
  goal: WatchGoalV1;
  alert: WatchAlertV1 | null;
  displayName: string | null;
  target: WatchStepTargetV1 | null;
  /** Indices from `workout.steps` down through `repeatSteps` (the AutoFix.stepPath convention). */
  sourcePath: number[];
}

export interface WatchIntervalStepV1 extends WatchStepV1 {
  purpose: 'work' | 'recovery';
}

export interface WatchBlockV1 {
  iterations: number;
  steps: WatchIntervalStepV1[];
}

export type WatchWarning =
  | 'empty-workout'
  | 'extra-warmup-in-block'
  | 'extra-cooldown-in-block'
  | 'nested-repeat-unrolled'
  | 'empty-repeat-dropped'
  | 'hr-without-max-hr'
  | 'single-pace-widened'
  | 'zone-without-paces'
  | 'name-truncated';

export interface WatchWorkoutV1 {
  schema: typeof WATCH_WORKOUT_SCHEMA;
  version: typeof WATCH_WORKOUT_VERSION;
  /** sha256 (16 hex) of the canonical JSON of every other field. Same content ⇒ same hash. */
  hash: string;
  name: string;
  activity: 'running';
  location: 'outdoor';
  workoutKey: string | null;
  partKind: NonNullable<ParsedWorkout['partKind']> | null;
  optional: boolean;
  warmup: WatchStepV1 | null;
  blocks: WatchBlockV1[];
  cooldown: WatchStepV1 | null;
  notes: string | null;
  warnings: WatchWarning[];
}

export interface SerializeOptions {
  /** The athlete's group profile — only used for zone-only pace steps. */
  paceProfile?: StoredPaceProfile | null;
  /** athletes.max_hr_bpm (migration 103). Without it HR% stays text. */
  maxHrBpm?: number | null;
  /**
   * Whether range ALERTS may be set. The same gate Garmin's `paceTarget` is:
   * academy athlete, coach setting on, caller didn't veto. False ⇒ info-only.
   */
  alerts?: boolean;
}

const isRepeat = (step: WorkoutStep): boolean => !!(step.repeatCount && step.repeatSteps);

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function goalFor(step: WorkoutStep): WatchGoalV1 {
  const value = Number(step.durationValue);
  if (step.durationType === 'distance' && value > 0) return { type: 'distance', meters: value };
  if (step.durationType === 'time' && value > 0) return { type: 'time', seconds: value };
  return { type: 'open' };
}

function purposeFor(step: WorkoutStep): 'work' | 'recovery' {
  return step.type === 'rest' || step.type === 'recovery' || step.type === 'cooldown' ? 'recovery' : 'work';
}

/** The step's pace in sec/km, resolved the converter's way — or null. */
function paceFor(
  step: WorkoutStep,
  profile: StoredPaceProfile | null | undefined,
  warn: (w: WatchWarning) => void,
): { min: number; max: number } | null {
  if (step.targetType !== 'pace') return null;
  const min = Number(step.targetPaceMinPerKm);
  if (min > 0) {
    const max = Number(step.targetPaceMaxPerKm);
    return { min, max: max > 0 ? max : min };
  }
  if (step.targetZone) {
    const range = getPaceForZone(step.targetZone, profile);
    if (range) return { min: range.min, max: range.max };
    warn('zone-without-paces');
  }
  return null;
}

function trimName(text: string | null | undefined, warn: (w: WatchWarning) => void): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= MAX_DISPLAY_NAME) return t;
  warn('name-truncated');
  return `${t.slice(0, MAX_DISPLAY_NAME - 1).trimEnd()}…`;
}

function buildStep(
  step: WorkoutStep,
  path: number[],
  opts: SerializeOptions,
  warn: (w: WatchWarning) => void,
): WatchStepV1 {
  const profile = opts.paceProfile ?? {};
  const target: WatchStepTargetV1 = {};
  let alert: WatchAlertV1 | null = null;
  let hrText: string | null = null;

  const pace = paceFor(step, profile, warn);
  if (pace) {
    const lo = Math.min(pace.min, pace.max);
    const hi = Math.max(pace.min, pace.max);
    target.pace = { minSecPerKm: lo, maxSecPerKm: hi };
    if (opts.alerts) {
      let fast = lo;
      let slow = hi;
      if (fast === slow) {
        // A zero-width speed range beeps at every GPS wobble.
        warn('single-pace-widened');
        fast -= SINGLE_PACE_TOLERANCE_SEC;
        slow += SINGLE_PACE_TOLERANCE_SEC;
      }
      alert = { type: 'speedRange', minMps: round3(1000 / slow), maxMps: round3(1000 / fast), metric: 'current' };
    }
  }

  if (step.targetType === 'heart_rate' && Number(step.targetHrMinPct) > 0) {
    const minPct = Number(step.targetHrMinPct);
    const maxPct = Number(step.targetHrMaxPct) > 0 ? Number(step.targetHrMaxPct) : minPct;
    const maxHr = Number(opts.maxHrBpm) > 0 ? Number(opts.maxHrBpm) : null;
    const minBpm = maxHr ? Math.round((Math.min(minPct, maxPct) / 100) * maxHr) : null;
    const maxBpm = maxHr ? Math.round((Math.max(minPct, maxPct) / 100) * maxHr) : null;
    target.heartRate = { minPct: Math.min(minPct, maxPct), maxPct: Math.max(minPct, maxPct), minBpm, maxBpm };
    if (!maxHr) warn('hr-without-max-hr');
    if (opts.alerts && minBpm != null && maxBpm != null) {
      alert = { type: 'heartRateRange', minBpm, maxBpm };
    } else {
      const lo = Math.min(minPct, maxPct);
      const hi = Math.max(minPct, maxPct);
      hrText = lo === hi ? `${lo}% דופק` : `${lo}-${hi}% דופק`;
    }
  }

  const base = buildStepDescription(step, profile);
  const displayName = trimName([base, hrText].filter(Boolean).join(' '), warn);

  return {
    goal: goalFor(step),
    alert,
    displayName,
    target: Object.keys(target).length ? target : null,
    sourcePath: path,
  };
}

/** A repeat's runnable steps, nested repeats unrolled inline. */
function unroll(
  steps: WorkoutStep[],
  path: number[],
  opts: SerializeOptions,
  warn: (w: WatchWarning) => void,
): WatchIntervalStepV1[] {
  const out: WatchIntervalStepV1[] = [];
  steps.forEach((child, i) => {
    const childPath = [...path, i];
    if (isRepeat(child)) {
      const inner = unroll(child.repeatSteps!, childPath, opts, warn);
      if (inner.length === 0) {
        warn('empty-repeat-dropped');
        return;
      }
      warn('nested-repeat-unrolled');
      const times = Math.max(1, Math.floor(Number(child.repeatCount)));
      for (let k = 0; k < times; k++) out.push(...inner);
      return;
    }
    out.push({ purpose: purposeFor(child), ...buildStep(child, childPath, opts, warn) });
  });
  return out;
}

/** Canonical JSON: keys sorted at every level, so jsonb's reordering can't change a hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashWatchWorkout(workout: Omit<WatchWorkoutV1, 'hash'> | WatchWorkoutV1): string {
  const { hash: _ignored, ...rest } = workout as WatchWorkoutV1;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex').slice(0, 16);
}

export function serializeWatchWorkout(workout: ParsedWorkout, opts: SerializeOptions = {}): WatchWorkoutV1 {
  const warnings = new Set<WatchWarning>();
  const warn = (w: WatchWarning) => warnings.add(w);
  const steps = Array.isArray(workout.steps) ? workout.steps : [];

  let warmup: WatchStepV1 | null = null;
  let cooldown: WatchStepV1 | null = null;
  let first = 0;
  let last = steps.length - 1;

  if (steps.length > 0 && steps[0].type === 'warmup' && !isRepeat(steps[0])) {
    warmup = buildStep(steps[0], [0], opts, warn);
    first = 1;
  }
  if (last >= first && steps[last].type === 'cooldown' && !isRepeat(steps[last])) {
    cooldown = buildStep(steps[last], [last], opts, warn);
    last -= 1;
  }

  const blocks: WatchBlockV1[] = [];
  let run: WatchIntervalStepV1[] = [];
  const flush = () => {
    if (run.length) blocks.push({ iterations: 1, steps: run });
    run = [];
  };
  for (let i = first; i <= last; i++) {
    const step = steps[i];
    if (isRepeat(step)) {
      flush();
      const inner = unroll(step.repeatSteps!, [i], opts, warn);
      if (inner.length === 0) {
        warn('empty-repeat-dropped');
        continue;
      }
      blocks.push({ iterations: Math.max(1, Math.floor(Number(step.repeatCount))), steps: inner });
      continue;
    }
    if (step.type === 'warmup') warn('extra-warmup-in-block');
    if (step.type === 'cooldown') warn('extra-cooldown-in-block');
    run.push({ purpose: purposeFor(step), ...buildStep(step, [i], opts, warn) });
  }
  flush();

  // WorkoutKit needs something to run between warmup and cooldown.
  if (blocks.length === 0) {
    const lone = warmup ?? cooldown;
    if (lone) {
      const purpose = warmup ? 'work' : 'recovery';
      blocks.push({ iterations: 1, steps: [{ purpose, ...lone }] });
      if (warmup) warmup = null;
      else cooldown = null;
    } else {
      warn('empty-workout');
      blocks.push({
        iterations: 1,
        steps: [{ purpose: 'work', goal: { type: 'open' }, alert: null, displayName: trimName(workout.name, warn), target: null, sourcePath: [] }],
      });
    }
  }

  const body: Omit<WatchWorkoutV1, 'hash'> = {
    schema: WATCH_WORKOUT_SCHEMA,
    version: WATCH_WORKOUT_VERSION,
    name: trimName(workout.name, warn) || 'אימון',
    activity: 'running',
    location: 'outdoor',
    workoutKey: workout.workoutKey || null,
    partKind: workout.partKind || null,
    optional: workout.optional === true,
    warmup,
    blocks,
    cooldown,
    notes: workout.description?.trim() || null,
    warnings: [...warnings].sort(),
  };
  return { ...body, hash: hashWatchWorkout(body) };
}

/** Every step the watch will run, in order, with block repeats expanded. */
export function expandedSteps(workout: WatchWorkoutV1): WatchStepV1[] {
  const out: WatchStepV1[] = [];
  if (workout.warmup) out.push(workout.warmup);
  for (const block of workout.blocks) for (let i = 0; i < block.iterations; i++) out.push(...block.steps);
  if (workout.cooldown) out.push(workout.cooldown);
  return out;
}
