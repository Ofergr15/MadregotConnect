import { describe, expect, it } from 'vitest';
import { buildVerdict, directionKey, toExecutionSummary } from '@/lib/plan-execution/verdict';
import { assessWorkout, buildPlannedWorkout, DEFAULT_TOLERANCES, type ActualActivity } from '@/lib/academy/adherence';
import { flattenPlannedSteps, findPlannedEfforts, matchLapsToSteps, type Lap } from '@/lib/academy/segments';
import { effortReportFor, segmentReportFor } from '@/lib/plan-execution/resolve';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

/**
 * Nov 20 user report: a PACE-ONLY plan (no repeat block) cut short read "did not
 * complete all the reps". Reps exist only where the coach wrote a repeat of 2+.
 * Synthetic plans and laps; scoring numerics are asserted unchanged.
 */
const DATE = '2026-07-13';
const P = DEFAULT_TOLERANCES.paceSec;
const step = (o: Partial<WorkoutStep>) => o as WorkoutStep;

/** 8 km easy, then two separate 1 km blocks at 4:30 (no repeat), 1 km cool-down. */
function paceOnly(): ParsedWorkout {
  const block = { type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 265, targetPaceMaxPerKm: 275 } as const;
  return { dayOfWeek: 1, name: 'tempo', steps: [
    step({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 8000, targetType: 'no_target' }),
    step({ order: 2, ...block }),
    step({ order: 3, ...block }),
    step({ order: 4, type: 'cooldown', durationType: 'distance', durationValue: 1000, targetType: 'no_target' }),
  ] } as ParsedWorkout;
}
/** Warm-up, 6 × (800 at 3:20, 90 s jog), cool-down. */
function sixBy800(): ParsedWorkout {
  return { dayOfWeek: 1, name: '6x800', steps: [
    step({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' }),
    step({ order: 2, type: 'interval', durationType: 'open', repeatCount: 6, repeatSteps: [
      step({ order: 1, type: 'interval', durationType: 'distance', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 195, targetPaceMaxPerKm: 205 }),
      step({ order: 2, type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' }),
    ] }),
    step({ order: 3, type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'no_target' }),
  ] } as ParsedWorkout;
}
const actual = (o: Partial<ActualActivity>): ActualActivity =>
  ({ id: 'act-1', date: DATE, distance: 5000, duration: 1500, movingDuration: 1500, averagePace: 300, ...o });

function verdictOf(w: ParsedWorkout, laps: Lap[], a: ActualActivity) {
  return buildVerdict({
    activityId: 'act-1', athleteId: 'ath-1',
    adherence: assessWorkout(buildPlannedWorkout(w, DATE), a, DEFAULT_TOLERANCES),
    segments: segmentReportFor(w, laps, P),
    efforts: effortReportFor(w, laps, P),
  });
}

describe('repeat origin survives flattening', () => {
  it('top-level steps carry no repeatOf; repeat children carry the count', () => {
    expect(flattenPlannedSteps(paceOnly()).map(s => s.repeatOf)).toEqual([undefined, undefined, undefined, undefined]);
    const six = flattenPlannedSteps(sixBy800());
    expect(six.filter(s => s.repeatOf === 6)).toHaveLength(12);
    expect(six[0].repeatOf).toBeUndefined();
  });
  it('keys exist in both locales', async () => {
    for (const f of ['he', 'en']) {
      const m = (await import(`../../messages/${f}.json`)).default.execution;
      expect(typeof m.dir_incomplete_parts).toBe('string');
      expect(typeof m.detail_incomplete_parts).toBe('string');
    }
  });
});

describe('pace-only plan, second block abandoned (jogged home)', () => {
  const laps: Lap[] = [
    { distance: 8000, duration: 2560, averagePace: 320 },
    { distance: 1000, duration: 270, averagePace: 270 },
    { distance: 1000, duration: 450, averagePace: 450 },
    { distance: 500, duration: 225, averagePace: 450 },
    { distance: 500, duration: 225, averagePace: 450 },
  ];  // 5 laps against 4 steps: not aligned, so the order-free rep search answers
  const a = actual({ distance: 11000, duration: 3730, averagePace: 339 });

  it('keeps the direction and score, but says "parts", never "reps"', () => {
    const efforts = findPlannedEfforts(flattenPlannedSteps(paceOnly()), laps, P);
    expect(efforts.repeatPlan).toBe(false);
    const v = verdictOf(paceOnly(), laps, a);
    expect(v.direction).toBe('incomplete');          // unchanged machine value
    expect(v.partsNotReps).toBe(true);
    expect(directionKey(v)).toBe('dir_incomplete_parts');
    expect(toExecutionSummary(v).partsNotReps).toBe(true);
  });

  it('no HR status on any row: the plan has no HR target', () => {
    const rep = matchLapsToSteps(flattenPlannedSteps(paceOnly()), laps, P);
    for (const s of rep?.segments ?? []) {
      expect(s.metric).not.toBe('hr');
      expect(s.plannedHrMin ?? null).toBeNull();
    }
  });
});

describe('6×800 with a rep missing still counts its reps', () => {
  it('direction is incomplete and the counts are unchanged', () => {
    const laps: Lap[] = [{ distance: 2000, duration: 640, averagePace: 320 }];
    for (let i = 0; i < 5; i++) { laps.push({ distance: 800, duration: 160, averagePace: 200 }); laps.push({ distance: 250, duration: 90, averagePace: 360 }); }
    laps.push({ distance: 2000, duration: 640, averagePace: 320 });
    const efforts = effortReportFor(sixBy800(), laps, P)!;
    expect(efforts.repeatPlan).toBe(true);
    expect([efforts.neededTotal, efforts.foundTotal]).toEqual([6, 5]);
    const v = verdictOf(sixBy800(), laps, actual({ distance: 9250, duration: 2530, averagePace: 273 }));
    expect(v.direction).toBe('incomplete');
    expect(v.partsNotReps).toBeUndefined();
    expect(directionKey(v)).toBe('dir_incomplete');
    expect(v.effortCounts).toEqual({ needed: 6, attempted: 5, found: 5 });
  });
});

describe('HR plan still grades HR', () => {
  it('a bpm-target step is metric hr and gets an HR status', () => {
    const w = { dayOfWeek: 1, name: 'hr', steps: [
      step({ order: 1, type: 'interval', durationType: 'distance', durationValue: 5000, targetType: 'heart_rate', targetHrMinPct: 140, targetHrMaxPct: 150 }),
      step({ order: 2, type: 'cooldown', durationType: 'distance', durationValue: 1000, targetType: 'no_target' }),
    ] } as ParsedWorkout;
    const rep = matchLapsToSteps(flattenPlannedSteps(w), [
      { distance: 5000, duration: 1500, averagePace: 300, averageHR: 165 },
      { distance: 1000, duration: 330, averagePace: 330, averageHR: 140 },
    ], P);
    expect(rep?.segments[0].metric).toBe('hr');
    expect(rep?.segments[0].status).not.toBe('unknown');
  });
});
