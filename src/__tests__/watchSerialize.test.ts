import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  expandedSteps,
  hashWatchWorkout,
  MAX_DISPLAY_NAME,
  serializeWatchWorkout,
  type WatchWorkoutV1,
} from '@/lib/watch/serialize';
import { convertToGarminWorkout } from '@/lib/garmin/converter';
import { getDefaultPaceProfile } from '@/lib/garmin/pace';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import {
  ALL_FIXTURES,
  brokenRepeats,
  doubleDayParts,
  easyOpen,
  empty,
  fartlek,
  heartRate,
  intervals,
  nestedRepeat,
  tempoDoubleWarmup,
  zoneOnly,
} from './fixtures/watch-workouts';

const LIVE = { marathonGoal: 'SUB 2:30', offsetSeconds: 0 };

/** Structural invariants WorkoutKit imposes, checked on every output. */
function assertWorkoutKitShape(w: WatchWorkoutV1) {
  expect(w.schema).toBe('madregot.watch-workout');
  expect(w.version).toBe(1);
  expect(w.blocks.length).toBeGreaterThan(0);
  for (const block of w.blocks) {
    expect(Number.isInteger(block.iterations)).toBe(true);
    expect(block.iterations).toBeGreaterThanOrEqual(1);
    expect(block.steps.length).toBeGreaterThan(0);
    for (const step of block.steps) {
      expect(['work', 'recovery']).toContain(step.purpose);
      // No nesting survives: a step is a leaf.
      expect((step as unknown as { repeatSteps?: unknown }).repeatSteps).toBeUndefined();
    }
  }
  for (const step of expandedSteps(w)) {
    if (step.goal.type === 'distance') expect(step.goal.meters).toBeGreaterThan(0);
    if (step.goal.type === 'time') expect(step.goal.seconds).toBeGreaterThan(0);
    if (step.alert?.type === 'speedRange') {
      expect(step.alert.minMps).toBeLessThan(step.alert.maxMps);
      expect(step.alert.minMps).toBeGreaterThan(0);
    }
    if (step.alert?.type === 'heartRateRange') expect(step.alert.minBpm).toBeLessThanOrEqual(step.alert.maxBpm);
    if (step.displayName) expect(step.displayName.length).toBeLessThanOrEqual(MAX_DISPLAY_NAME);
  }
  expect(w.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(hashWatchWorkout(w)).toBe(w.hash);
}

describe('every real fixture produces a WorkoutKit-valid shape', () => {
  for (const [name, workout] of Object.entries(ALL_FIXTURES)) {
    for (const alerts of [false, true]) {
      it(`${name} (${alerts ? 'alerts' : 'info-only'})`, () => {
        assertWorkoutKitShape(serializeWatchWorkout(workout, { paceProfile: LIVE, alerts, maxHrBpm: 190 }));
        assertWorkoutKitShape(serializeWatchWorkout(workout, { paceProfile: getDefaultPaceProfile(), alerts }));
      });
    }
  }
});

describe('warmup and cooldown', () => {
  it('lifts a leading warmup and a trailing cooldown out of the blocks', () => {
    const w = serializeWatchWorkout(intervals);
    expect(w.warmup?.goal).toEqual({ type: 'distance', meters: 2000 });
    expect(w.cooldown?.goal).toEqual({ type: 'distance', meters: 1000 });
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].iterations).toBe(6);
    expect(w.blocks[0].steps.map((s) => s.purpose)).toEqual(['work', 'recovery']);
  });

  it('keeps only ONE of each — the extras run inside a block', () => {
    const w = serializeWatchWorkout(tempoDoubleWarmup);
    expect(w.warmup?.goal).toEqual({ type: 'time', seconds: 900 });
    expect(w.cooldown?.goal).toEqual({ type: 'open' });
    expect(w.cooldown?.displayName).toBe('מתיחות');
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].steps.map((s) => s.goal)).toEqual([
      { type: 'distance', meters: 400 },
      { type: 'distance', meters: 8000 },
      { type: 'time', seconds: 300 },
    ]);
    expect(w.blocks[0].steps[2].purpose).toBe('recovery');
    expect(w.warnings).toEqual(expect.arrayContaining(['extra-warmup-in-block', 'extra-cooldown-in-block']));
  });

  it('a warmup-only part becomes the single block step (blocks are never empty)', () => {
    const w = serializeWatchWorkout(doubleDayParts[0]);
    expect(w.warmup).toBeNull();
    expect(w.blocks).toEqual([{ iterations: 1, steps: [expect.objectContaining({ purpose: 'work', goal: { type: 'time', seconds: 1200 } })] }]);
    const c = serializeWatchWorkout(doubleDayParts[2]);
    expect(c.cooldown).toBeNull();
    expect(c.blocks[0].steps[0].purpose).toBe('recovery');
  });

  it('a lone step is a block, not both warmup and cooldown', () => {
    const w = serializeWatchWorkout({ dayOfWeek: 0, name: 'x', steps: [{ order: 1, type: 'warmup', durationType: 'time', durationValue: 60, targetType: 'no_target' }] });
    expect(w.warmup).toBeNull();
    expect(w.cooldown).toBeNull();
    expect(w.blocks).toHaveLength(1);
  });

  it('a repeat at either end is never taken as the warmup or cooldown', () => {
    const rep: WorkoutStep = { order: 1, type: 'warmup', durationType: 'open', targetType: 'no_target', repeatCount: 2, repeatSteps: [{ order: 1, type: 'warmup', durationType: 'time', durationValue: 30, targetType: 'no_target' }] };
    const w = serializeWatchWorkout({ dayOfWeek: 0, name: 'x', steps: [rep] });
    expect(w.warmup).toBeNull();
    expect(w.blocks[0].iterations).toBe(2);
  });
});

describe('repeats', () => {
  it('the fartlek: 15 iterations of three 1-minute steps, info-only', () => {
    const w = serializeWatchWorkout(fartlek, { paceProfile: LIVE });
    expect(w.warmup?.goal).toEqual({ type: 'time', seconds: 900 });
    expect(w.warmup?.alert).toBeNull();
    expect(w.warmup?.target?.pace).toEqual({ minSecPerKm: 270, maxSecPerKm: 330 });
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].iterations).toBe(15);
    expect(w.blocks[0].steps.map((s) => s.displayName)).toEqual(['קל מתון - נוח', 'מתון - בינוני', 'בינוני - קשה']);
    expect(expandedSteps(w)).toHaveLength(1 + 45);
  });

  it('unrolls a nested repeat inline and keeps the outer count', () => {
    const w = serializeWatchWorkout(nestedRepeat, { alerts: true });
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].iterations).toBe(3);
    // 4 x (fast, jog) unrolled = 8, then the float = 9.
    expect(w.blocks[0].steps).toHaveLength(9);
    expect(w.blocks[0].steps.slice(0, 8).map((s) => s.purpose)).toEqual(
      ['work', 'recovery', 'work', 'recovery', 'work', 'recovery', 'work', 'recovery'],
    );
    expect(w.blocks[0].steps[8].displayName).toBe('ציפה');
    expect(w.blocks[0].steps[0].sourcePath).toEqual([1, 0, 0]);
    expect(w.blocks[0].steps[8].sourcePath).toEqual([1, 1]);
    expect(w.warnings).toContain('nested-repeat-unrolled');
    // Same total work as the tree: 3 x (4 x 400 + 400) = 6000 m between warmup and cooldown.
    const metres = w.blocks[0].steps.reduce((sum, s) => sum + (s.goal.type === 'distance' ? s.goal.meters : 0), 0) * 3;
    expect(metres).toBe(6000);
  });

  it('merges consecutive plain steps into one block and splits around repeats', () => {
    const plain = (o: number): WorkoutStep => ({ order: o, type: 'active', durationType: 'distance', durationValue: 1000, targetType: 'no_target' });
    const w = serializeWatchWorkout({
      dayOfWeek: 0, name: 'x',
      steps: [plain(1), plain(2), { ...plain(3), repeatCount: 2, repeatSteps: [plain(1)] }, plain(4)],
    });
    expect(w.blocks.map((b) => [b.iterations, b.steps.length])).toEqual([[1, 2], [2, 1], [1, 1]]);
  });

  it('drops an empty repeat, and treats count-without-steps as a plain step (the converter rule)', () => {
    const w = serializeWatchWorkout(brokenRepeats);
    expect(w.warnings).toContain('empty-repeat-dropped');
    expect(w.blocks).toEqual([{ iterations: 1, steps: [expect.objectContaining({ goal: { type: 'distance', meters: 5000 } })] }]);
    // The Garmin converter agrees that step 2 is an executable step, not a repeat.
    const garmin = convertToGarminWorkout(brokenRepeats, LIVE).workoutSegments[0].workoutSteps;
    expect(garmin[1].type).toBe('ExecutableStepDTO');
  });

  it('floors a fractional repeat count and never goes below one', () => {
    const one: WorkoutStep = { order: 1, type: 'interval', durationType: 'distance', durationValue: 100, targetType: 'no_target' };
    const w = serializeWatchWorkout({ dayOfWeek: 0, name: 'x', steps: [{ ...one, repeatCount: 3.7, repeatSteps: [one] }] });
    expect(w.blocks[0].iterations).toBe(3);
  });
});

describe('goals', () => {
  it('open when there is no positive value, like Garmin', () => {
    const w = serializeWatchWorkout(easyOpen);
    expect(w.blocks[0].steps[0].goal).toEqual({ type: 'open' });
    const zero = serializeWatchWorkout({ dayOfWeek: 0, name: 'x', steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 0, targetType: 'no_target' }] });
    expect(zero.blocks[0].steps[0].goal).toEqual({ type: 'open' });
  });

  it('ignores durationMaxValue — a watch takes one number', () => {
    const w = serializeWatchWorkout({ dayOfWeek: 0, name: 'x', steps: [{ order: 1, type: 'active', durationType: 'time', durationValue: 2400, durationMaxValue: 3000, targetType: 'no_target' }] });
    expect(w.blocks[0].steps[0].goal).toEqual({ type: 'time', seconds: 2400 });
  });
});

describe('pace', () => {
  it('info-only by default: text on the step, no alert', () => {
    const step = serializeWatchWorkout(intervals).blocks[0].steps[0];
    expect(step.alert).toBeNull();
    expect(step.displayName).toBe('3:20');
    expect(step.target?.pace).toEqual({ minSecPerKm: 200, maxSecPerKm: 200 });
  });

  it('a pace RANGE becomes a speed range in m/s, slow end first', () => {
    const step = serializeWatchWorkout(tempoDoubleWarmup, { alerts: true }).blocks[0].steps[1];
    expect(step.alert).toEqual({ type: 'speedRange', minMps: 4.444, maxMps: 4.651, metric: 'current' });
    // Notes without a pace get the pace label prefixed, exactly as on Garmin.
    expect(step.displayName).toBe('3:35-3:45 ג׳ל');
  });

  it('a single pace is widened to ±5 s/km when it has to alert', () => {
    const w = serializeWatchWorkout(intervals, { alerts: true });
    const step = w.blocks[0].steps[0];
    expect(step.alert).toEqual({ type: 'speedRange', minMps: Math.round((1000 / 205) * 1000) / 1000, maxMps: Math.round((1000 / 195) * 1000) / 1000, metric: 'current' });
    expect(w.warnings).toContain('single-pace-widened');
  });

  it('a zone-only step on the production offset profile has no pace and no invented alert', () => {
    const w = serializeWatchWorkout(zoneOnly, { paceProfile: LIVE, alerts: true });
    expect(w.blocks[0].steps[0].alert).toBeNull();
    expect(w.blocks[0].steps[0].target).toBeNull();
    expect(w.blocks[0].steps[0].displayName).toBe('ריצה קלה');
    expect(w.warnings).toContain('zone-without-paces');
  });

  it('a zone-only step on a real zone table resolves like the converter', () => {
    const w = serializeWatchWorkout(zoneOnly, { paceProfile: getDefaultPaceProfile(), alerts: true });
    expect(w.blocks[0].steps[0].target?.pace).toEqual({ minSecPerKm: 330, maxSecPerKm: 390 });
    expect(w.blocks[0].steps[0].alert?.type).toBe('speedRange');
  });

  it('the step text equals the Garmin step description for every fixture', () => {
    for (const workout of Object.values(ALL_FIXTURES)) {
      const garmin = convertToGarminWorkout(workout, LIVE).workoutSegments[0].workoutSteps;
      const flatGarmin = garmin.flatMap(function walk(s): string[] {
        return s.type === 'RepeatGroupDTO' ? (s.workoutSteps || []).flatMap(walk) : [s.description ?? ''];
      });
      const w = serializeWatchWorkout(workout, { paceProfile: LIVE });
      // Compare as sets of texts: the shapes differ (Apple unrolls), the words must not.
      const appleTexts = new Set(expandedSteps(w).map((s) => s.displayName ?? '').filter(Boolean));
      for (const text of flatGarmin.filter(Boolean)) expect(appleTexts.has(text)).toBe(true);
    }
  });
});

describe('heart rate', () => {
  it('turns % of max into bpm and alerts only when allowed', () => {
    const info = serializeWatchWorkout(heartRate, { maxHrBpm: 190 }).blocks[0].steps[0];
    expect(info.alert).toBeNull();
    expect(info.target?.heartRate).toEqual({ minPct: 70, maxPct: 78, minBpm: 133, maxBpm: 148 });
    expect(info.displayName).toBe('70-78% דופק');
    const alerting = serializeWatchWorkout(heartRate, { maxHrBpm: 190, alerts: true }).blocks[0].steps[0];
    expect(alerting.alert).toEqual({ type: 'heartRateRange', minBpm: 133, maxBpm: 148 });
  });

  it('without a max HR there is nothing to alert on — text only, and a warning', () => {
    const w = serializeWatchWorkout(heartRate, { alerts: true });
    expect(w.blocks[0].steps[0].alert).toBeNull();
    expect(w.blocks[0].steps[0].target?.heartRate?.minBpm).toBeNull();
    expect(w.blocks[0].steps[0].displayName).toBe('70-78% דופק');
    expect(w.warnings).toContain('hr-without-max-hr');
  });

  it('never carries two alerts: pace fields on an HR step are ignored', () => {
    const step: WorkoutStep = { order: 1, type: 'active', durationType: 'time', durationValue: 600, targetType: 'heart_rate', targetHrMinPct: 80, targetPaceMinPerKm: 240 };
    const s = serializeWatchWorkout({ dayOfWeek: 0, name: 'x', steps: [step] }, { alerts: true, maxHrBpm: 200 }).blocks[0].steps[0];
    expect(s.alert).toEqual({ type: 'heartRateRange', minBpm: 160, maxBpm: 160 });
    expect(s.target?.pace).toBeUndefined();
  });
});

describe('workout-level fields', () => {
  it('an empty workout still runs: one open step named after it', () => {
    const w = serializeWatchWorkout(empty);
    expect(w.blocks).toEqual([{ iterations: 1, steps: [expect.objectContaining({ goal: { type: 'open' }, displayName: 'מנוחה פעילה' })] }]);
    expect(w.warnings).toEqual(['empty-workout']);
  });

  it('carries the part identity and the optional flag', () => {
    const evening = serializeWatchWorkout(doubleDayParts[3]);
    expect(evening.workoutKey).toBe('d1-p4-evening');
    expect(evening.partKind).toBe('evening');
    expect(evening.optional).toBe(true);
  });

  it('truncates a long name and says so', () => {
    const w = serializeWatchWorkout({ ...easyOpen, name: 'א'.repeat(200) });
    expect(w.name.length).toBe(MAX_DISPLAY_NAME);
    expect(w.name.endsWith('…')).toBe(true);
    expect(w.warnings).toContain('name-truncated');
  });

  it('survives garbage: missing steps array', () => {
    const w = serializeWatchWorkout({ dayOfWeek: 0, name: '' } as unknown as ParsedWorkout);
    expect(w.name).toBe('אימון');
    expect(w.blocks).toHaveLength(1);
  });
});

describe('hash', () => {
  it('is stable across runs and key order', () => {
    const a = serializeWatchWorkout(intervals, { alerts: true });
    const b = serializeWatchWorkout(JSON.parse(JSON.stringify(intervals)), { alerts: true });
    expect(a.hash).toBe(b.hash);
    // jsonb reorders keys; the hash must not care.
    const reordered = JSON.parse(canonicalJson(a)) as WatchWorkoutV1;
    expect(hashWatchWorkout(reordered)).toBe(a.hash);
  });

  it('changes when anything the watch would run changes', () => {
    const base = serializeWatchWorkout(intervals).hash;
    expect(serializeWatchWorkout(intervals, { alerts: true }).hash).not.toBe(base);
    const edited = JSON.parse(JSON.stringify(intervals)) as ParsedWorkout;
    edited.steps[1].repeatCount = 8;
    expect(serializeWatchWorkout(edited).hash).not.toBe(base);
  });

  it('is pure: the input workout is not mutated', () => {
    const copy = JSON.parse(JSON.stringify(nestedRepeat));
    serializeWatchWorkout(nestedRepeat, { alerts: true, maxHrBpm: 180 });
    expect(nestedRepeat).toEqual(copy);
  });
});
