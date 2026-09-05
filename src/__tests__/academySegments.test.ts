import { describe, it, expect } from 'vitest';
import {
  buildPlannedBands,
  flattenPlannedSteps,
  matchLapsToSteps,
  projectBandsToBins,
  type Lap,
} from '@/lib/academy/segments';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The per-segment grader. This is where a structured session actually gets
// judged — the adherence engine deliberately returns 'unknown' on pace for an
// interval workout and defers the question here, so these verdicts are the only
// answer an athlete gets to "did I hit my intervals?".

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    stepOrder: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[]): ParsedWorkout {
  return { name: 'W', dayOfWeek: 0, steps } as ParsedWorkout;
}

/** 2 km warmup, 4×(400 m interval + 200 m recovery), 1 km cooldown. */
function intervalSession(): ParsedWorkout {
  return workout([
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 330, targetPaceMaxPerKm: 340 }),
    step({
      durationType: 'open',
      repeatCount: 4,
      repeatSteps: [
        step({ type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 240, targetPaceMaxPerKm: 240 }),
        step({ type: 'recovery', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 420, targetPaceMaxPerKm: 420 }),
      ],
    }),
    step({ type: 'cooldown', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 360, targetPaceMaxPerKm: 360 }),
  ]);
}

describe('flattenPlannedSteps', () => {
  it('expands repeats into the order they are actually run', () => {
    const flat = flattenPlannedSteps(intervalSession());
    expect(flat).toHaveLength(10); // warmup + 4×(interval+recovery) + cooldown
    expect(flat.map(s => s.type)).toEqual([
      'warmup',
      'interval', 'recovery', 'interval', 'recovery',
      'interval', 'recovery', 'interval', 'recovery',
      'cooldown',
    ]);
    // Indices are the run order, not the position within the source step tree.
    expect(flat.map(s => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('grades paced work steps and never the rests', () => {
    const flat = flattenPlannedSteps(intervalSession());
    expect(flat.filter(s => s.graded).map(s => s.type)).toEqual(
      ['warmup', 'interval', 'interval', 'interval', 'interval', 'cooldown'],
    );
    // The recoveries carry a pace target and are still not graded — jogging a
    // recovery slower than written is not a missed workout.
    expect(flat.filter(s => s.type === 'recovery').every(s => s.graded === false)).toBe(true);
  });

  it('does not grade a step with no pace target', () => {
    const [only] = flattenPlannedSteps(workout([step({ targetType: 'no_target' })]));
    expect(only.graded).toBe(false);
  });

  it('mirrors a single pace into both bounds', () => {
    const [only] = flattenPlannedSteps(
      workout([step({ targetType: 'pace', targetPaceMinPerKm: 300 })]),
    );
    expect(only.paceMin).toBe(300);
    expect(only.paceMax).toBe(300);
  });

  it('labels a step by what it is and how long', () => {
    const labels = flattenPlannedSteps(workout([
      step({ type: 'interval', durationValue: 400 }),
      step({ type: 'warmup', durationValue: 2000 }),
      step({ type: 'active', durationValue: 1500 }),
      step({ type: 'active', durationType: 'time', durationValue: 1800 }),
      step({ type: 'rest', durationType: 'open' }),
    ])).map(s => s.label);
    expect(labels).toEqual(['Interval 400m', 'Warmup 2km', 'Run 1.5km', 'Run 30min', 'Rest']);
  });
});

describe('matchLapsToSteps', () => {
  const flat = () => flattenPlannedSteps(intervalSession());

  /** A lap the watch would record for a step run exactly to plan. */
  const lap = (distance: number, paceSecPerKm: number): Lap => ({
    distance,
    duration: Math.round((distance / 1000) * paceSecPerKm),
  });

  function lapsExactlyToPlan(): Lap[] {
    return [
      lap(2000, 335),
      lap(400, 240), lap(200, 420), lap(400, 240), lap(200, 420),
      lap(400, 240), lap(200, 420), lap(400, 240), lap(200, 420),
      lap(1000, 360),
    ];
  }

  it('grades every paced step when the laps line up', () => {
    const r = matchLapsToSteps(flat(), lapsExactlyToPlan());
    expect(r.aligned).toBe(true);
    expect(r.gradedCount).toBe(6);
    expect(r.onTargetCount).toBe(6);
    expect(r.reason).toBeUndefined();
  });

  it('calls out only the interval that was missed', () => {
    const laps = lapsExactlyToPlan();
    laps[5] = lap(400, 265); // third interval 25 s/km slow
    const r = matchLapsToSteps(flat(), laps);
    expect(r.onTargetCount).toBe(5);
    expect(r.segments[5].status).toBe('slower');
    expect(r.segments[1].status).toBe('on_target');
  });

  it('marks an interval run faster than the band, not just slower', () => {
    const laps = lapsExactlyToPlan();
    laps[1] = lap(400, 210);
    expect(matchLapsToSteps(flat(), laps).segments[1].status).toBe('faster');
  });

  it('leaves rests ungraded even when the lap is nowhere near the written pace', () => {
    const laps = lapsExactlyToPlan();
    laps[2] = lap(200, 600); // walked the recovery
    const r = matchLapsToSteps(flat(), laps);
    expect(r.segments[2].graded).toBe(false);
    expect(r.segments[2].status).toBe('unknown');
    expect(r.onTargetCount).toBe(6); // untouched
  });

  it('derives a lap pace when the watch did not report one', () => {
    const r = matchLapsToSteps(flat(), lapsExactlyToPlan());
    expect(r.segments[1].actualPace).toBe(240); // 96 s over 400 m
  });

  it('prefers the reported lap pace over deriving one', () => {
    const laps = lapsExactlyToPlan();
    laps[1] = { ...laps[1], averagePace: 300 };
    expect(matchLapsToSteps(flat(), laps).segments[1].actualPace).toBe(300);
  });

  // ── Refusing to guess ──────────────────────────────────────────────────────
  it('grades nothing rather than mislabelling when the lap count is off', () => {
    // One extra lap — the athlete pressed stop late — and positional alignment
    // would shift every verdict by one, painting good intervals red.
    const laps = [...lapsExactlyToPlan(), lap(150, 500)];
    const r = matchLapsToSteps(flat(), laps);
    expect(r.aligned).toBe(false);
    expect(r.onTargetCount).toBe(0);
    expect(r.segments.every(s => s.status === 'unknown')).toBe(true);
    expect(r.segments.every(s => s.actualPace === null)).toBe(true);
    expect(r.reason).toBe('lap count (11) does not match planned steps (10)');
  });

  it('explains an unstructured run as missing lap data', () => {
    const r = matchLapsToSteps(flat(), []);
    expect(r.aligned).toBe(false);
    expect(r.reason).toContain('no lap data');
  });

  it('explains an empty plan as having no steps', () => {
    const r = matchLapsToSteps([], [lap(1000, 300)]);
    expect(r.aligned).toBe(false);
    expect(r.reason).toBe('no planned steps');
  });

  it('is not aligned when both sides are empty', () => {
    // Zero laps against zero steps is a vacuous match, not a graded workout.
    expect(matchLapsToSteps([], []).aligned).toBe(false);
  });

  it('still reports the planned band for a step it could not grade', () => {
    const r = matchLapsToSteps(flat(), []);
    expect(r.segments[1].plannedPaceMin).toBe(240);
    expect(r.segments[1].plannedPaceMax).toBe(240);
  });

  it('honours a caller\'s pace tolerance', () => {
    const laps = lapsExactlyToPlan();
    laps[1] = lap(400, 248); // 8 s/km slow
    expect(matchLapsToSteps(flat(), laps).segments[1].status).toBe('slower');
    expect(matchLapsToSteps(flat(), laps, 10).segments[1].status).toBe('on_target');
  });
});

describe('buildPlannedBands', () => {
  it('lays paced work out on a meter timeline, with rests advancing the cursor', () => {
    const bands = buildPlannedBands(intervalSession());
    // warmup 0–2000, then interval/recovery alternating 400/200, then cooldown.
    // The recoveries move the cursor but contribute no band.
    expect(bands).toEqual([
      { startM: 0, endM: 2000, min: 330, max: 340 },
      { startM: 2000, endM: 2400, min: 240, max: 240 },
      { startM: 2600, endM: 3000, min: 240, max: 240 },
      { startM: 3200, endM: 3600, min: 240, max: 240 },
      { startM: 3800, endM: 4200, min: 240, max: 240 },
      { startM: 4400, endM: 5400, min: 360, max: 360 },
    ]);
  });

  it('places a timed step by converting its target pace to meters', () => {
    // 30 min at 5:00/km → 6000 m.
    const bands = buildPlannedBands(workout([
      step({ durationType: 'time', durationValue: 1800, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }),
    ]));
    expect(bands).toEqual([{ startM: 0, endM: 6000, min: 300, max: 300 }]);
  });

  it('emits nothing for a plan with no paced steps', () => {
    expect(buildPlannedBands(workout([step({ targetType: 'no_target' })]))).toEqual([]);
  });

  it('skips a step it cannot place on the timeline', () => {
    // Open-ended with no distance and no time: there is no honest length for it,
    // so it neither draws a band nor shifts what follows.
    const bands = buildPlannedBands(workout([
      step({ type: 'rest', durationType: 'open' }),
      step({ durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 300 }),
    ]));
    expect(bands).toEqual([{ startM: 0, endM: 1000, min: 300, max: 300 }]);
  });
});

describe('projectBandsToBins', () => {
  it('gives every bin a null when there is no plan to overlay', () => {
    expect(projectBandsToBins([], [1000, 1000])).toEqual([null, null]);
  });

  it('projects a single band straight onto matching bins', () => {
    const out = projectBandsToBins([{ startM: 0, endM: 2000, min: 300, max: 320 }], [1000, 1000]);
    expect(out).toEqual([
      { pace: 310, min: 300, max: 320 },
      { pace: 310, min: 300, max: 320 },
    ]);
  });

  it('weights a bin spanning two bands by how much of each it covers', () => {
    // The bin covers 500 m at 240 and 500 m at 340 → 290.
    const out = projectBandsToBins(
      [{ startM: 0, endM: 500, min: 240, max: 240 }, { startM: 500, endM: 1000, min: 340, max: 340 }],
      [1000],
    );
    expect(out).toEqual([{ pace: 290, min: 290, max: 290 }]);
  });

  it('breaks the overlay for a bin the plan barely covers', () => {
    // 400 m of a 1000 m bin — under half, so there is no value worth drawing.
    expect(projectBandsToBins([{ startM: 0, endM: 400, min: 240, max: 240 }], [1000])).toEqual([null]);
  });

  it('draws a bin covered exactly half way', () => {
    const out = projectBandsToBins([{ startM: 0, endM: 500, min: 240, max: 240 }], [1000]);
    expect(out).toEqual([{ pace: 240, min: 240, max: 240 }]);
  });

  it('handles uneven auto-lap splits, which is the case it exists for', () => {
    // An interval workout auto-laps per step: 630 m fast, 131 m slow.
    const out = projectBandsToBins(
      [{ startM: 0, endM: 630, min: 240, max: 240 }, { startM: 761, endM: 1391, min: 240, max: 240 }],
      [630, 131, 630],
    );
    expect(out[0]).toEqual({ pace: 240, min: 240, max: 240 });
    expect(out[1]).toBeNull(); // the recovery has no paced band over it
    expect(out[2]).toEqual({ pace: 240, min: 240, max: 240 });
  });

  it('never puts NaN in the overlay for a zero-width bin', () => {
    // A zero-width bin passes `covered >= width * 0.5` with nothing covered, and
    // the weighted averages would divide 0 by 0.
    expect(projectBandsToBins([{ startM: 0, endM: 1000, min: 300, max: 300 }], [0])).toEqual([null]);
  });

  it('gives bins past the end of the plan a null', () => {
    const out = projectBandsToBins([{ startM: 0, endM: 1000, min: 300, max: 300 }], [1000, 1000]);
    expect(out[1]).toBeNull();
  });
});
