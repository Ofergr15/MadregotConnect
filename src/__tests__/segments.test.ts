import { describe, it, expect } from 'vitest';
import {
  buildPlannedBands,
  flattenPlannedSteps,
  isContinuousPlan,
  matchLapsToSteps,
  projectBandsToBins,
  Lap,
} from '../lib/academy/segments';
import { laneWorkouts } from '../lib/academy/group-lane';
import { ParsedWorkout, WorkoutStep } from '../lib/ai/types';

function wk(steps: Partial<WorkoutStep>[]): ParsedWorkout {
  return {
    dayOfWeek: 1, name: 'Test',
    steps: steps.map((s, i) => ({ order: i + 1, type: 'active', durationType: 'open', targetType: 'no_target', ...s } as WorkoutStep)),
  };
}

describe('flattenPlannedSteps — repeat expansion', () => {
  it('expands 5× (400m interval + rest) into 10 ordered segments', () => {
    const w = wk([
      { type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 330 },
      {
        type: 'interval', durationType: 'open', repeatCount: 5,
        repeatSteps: [
          { order: 1, type: 'interval', durationType: 'distance', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 195, targetPaceMaxPerKm: 200 } as WorkoutStep,
          { order: 2, type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' } as WorkoutStep,
        ],
      },
    ]);
    const flat = flattenPlannedSteps(w);
    expect(flat.length).toBe(1 + 5 * 2); // warmup + 5×(interval+recovery)
    // Order preserved: warmup, then interval/recovery pairs.
    expect(flat[0].type).toBe('warmup');
    expect(flat[1].type).toBe('interval');
    expect(flat[2].type).toBe('recovery');
    // Interval graded (has pace), recovery not graded.
    expect(flat[1].graded).toBe(true);
    expect(flat[2].graded).toBe(false);
  });

  it('marks a no-pace run as not graded', () => {
    const flat = flattenPlannedSteps(wk([{ type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'no_target' }]));
    expect(flat[0].graded).toBe(false);
  });
});

// /api/academy/segments reads the plan through laneWorkouts(parsed, lane), where
// the lane is the athlete's own pace group. It used to take whichever group
// bucket appeared first in the blob — always group 1 — so a group-3 athlete was
// graded lap by lap against the club's fastest paces and told they were slower
// than target for a session they had actually hit. Same class of false verdict
// the whole-run grading fix removed; this is the per-segment half of it.
describe('lane-aware planned paces — the group-3 athlete is graded on group 3', () => {
  // A unified plan: one pace on the step, all three written into the note the way
  // the coach writes them. 3:20 (3:30) ((3:40)) = 200 / 210 / 220 sec per km.
  const unified = {
    workouts: [wk([
      {
        type: 'interval', durationType: 'distance', durationValue: 1000,
        targetType: 'pace', targetPaceMinPerKm: 200, targetPaceMaxPerKm: 200,
        notes: '3:20 (3:30) ((3:40))',
      },
    ])],
  };
  // Run at exactly the group-3 pace.
  const laps: Lap[] = [{ distance: 1000, duration: 220, averagePace: 220 }];

  const gradeAsLane = (lane: 1 | 2 | 3) => {
    const workouts = laneWorkouts(unified, lane);
    const flat = flattenPlannedSteps(workouts[0]);
    return { flat, report: matchLapsToSteps(flat, laps) };
  };

  it('resolves each lane to its own planned pace', () => {
    expect(gradeAsLane(1).flat[0].paceMin).toBe(200);
    expect(gradeAsLane(2).flat[0].paceMin).toBe(210);
    expect(gradeAsLane(3).flat[0].paceMin).toBe(220);
  });

  it('calls the group-3 pace on target for a group-3 athlete', () => {
    expect(gradeAsLane(3).report.segments[0].status).toBe('on_target');
  });

  it('is the verdict the old group-1 read got wrong', () => {
    // The regression, pinned: the same lap against lane 1 is 15s/km outside the
    // ±5s tolerance, which is the "slower than target" this route used to report.
    expect(gradeAsLane(1).report.segments[0].status).toBe('slower');
  });

  it('reads the pre-split group buckets of older rows too', () => {
    const grouped = {
      group1: { workouts: [wk([{ type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 200, targetPaceMaxPerKm: 200 }])] },
      group2: { workouts: [wk([{ type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 210, targetPaceMaxPerKm: 210 }])] },
      group3: { workouts: [wk([{ type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220 }])] },
    };
    const flat = flattenPlannedSteps(laneWorkouts(grouped, 3)[0]);
    expect(flat[0].paceMin).toBe(220);
    expect(matchLapsToSteps(flat, laps).segments[0].status).toBe('on_target');
  });

  it('leaves a single-pace plan alone whichever lane asks', () => {
    const single = { workouts: [wk([{ type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220 }])] };
    for (const lane of [1, 2, 3] as const) {
      expect(flattenPlannedSteps(laneWorkouts(single, lane)[0])[0].paceMin).toBe(220);
    }
  });
});

describe('matchLapsToSteps — alignment + verdicts', () => {
  const planned = flattenPlannedSteps(wk([
    { type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 },
    { type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' },
    { type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 },
  ]));

  it('grades each interval when laps line up (±5s)', () => {
    const laps: Lap[] = [
      { distance: 1000, duration: 302, averagePace: 302 }, // on target
      { distance: 200, duration: 60, averagePace: 300 },   // recovery, not graded
      { distance: 1000, duration: 315, averagePace: 315 }, // slower (>305)
    ];
    const r = matchLapsToSteps(planned, laps);
    expect(r.aligned).toBe(true);
    expect(r.segments[0].status).toBe('on_target');
    expect(r.segments[1].status).toBe('unknown'); // recovery not graded
    expect(r.segments[2].status).toBe('slower');
    expect(r.gradedCount).toBe(2);
    expect(r.onTargetCount).toBe(1);
  });

  it('flags a too-fast interval', () => {
    const laps: Lap[] = [
      { distance: 1000, duration: 290, averagePace: 290 }, // faster (<295)
      { distance: 200, duration: 60, averagePace: 300 },
      { distance: 1000, duration: 300, averagePace: 300 },
    ];
    const r = matchLapsToSteps(planned, laps);
    expect(r.segments[0].status).toBe('faster');
  });

  it('derives pace from distance/duration when averagePace missing', () => {
    const laps: Lap[] = [
      { distance: 1000, duration: 300 } as Lap,
      { distance: 200, duration: 60 } as Lap,
      { distance: 1000, duration: 300 } as Lap,
    ];
    const r = matchLapsToSteps(planned, laps);
    expect(r.segments[0].actualPace).toBe(300);
    expect(r.segments[0].status).toBe('on_target');
  });

  it('does not align (unknown) when lap count mismatches', () => {
    const laps: Lap[] = [{ distance: 1000, duration: 300, averagePace: 300 }];
    const r = matchLapsToSteps(planned, laps);
    expect(r.aligned).toBe(false);
    expect(r.segments.every(s => s.status === 'unknown')).toBe(true);
    expect(r.reason).toContain('does not match');
  });

  it('reports no-lap-data reason for a free run', () => {
    const r = matchLapsToSteps(planned, []);
    expect(r.aligned).toBe(false);
    expect(r.reason).toContain('not run on watch');
  });
});

/**
 * The guard on the per-km chart: is a kilometre grid an honest frame for this plan?
 *
 * Worth its own block because the obvious implementation is wrong, and wrong in a
 * way that reads as correct — see the "band geometry" case below, which is the bug
 * this function replaced.
 */
describe('isContinuousPlan — whether a per-km chart of this plan is honest', () => {
  /** Warmup, then 4 × (2 km rep + 2 min recovery), then cooldown. */
  const intervals = wk([
    { type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
    {
      type: 'interval', durationType: 'open', repeatCount: 4,
      repeatSteps: [
        { order: 1, type: 'interval', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 200, targetPaceMaxPerKm: 210 } as WorkoutStep,
        { order: 2, type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' } as WorkoutStep,
      ],
    },
    { type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
  ]);

  /** 2 km warmup, 6 km at marathon pace, 2 km cooldown — all three paced. */
  const progression = wk([
    { type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 320, targetPaceMaxPerKm: 340 },
    { type: 'active', durationType: 'distance', durationValue: 6000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300 },
    { type: 'cooldown', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 320, targetPaceMaxPerKm: 345 },
  ]);

  it('refuses a 4×2000 — a km bin there spans a rep and its recovery jog', () => {
    expect(isContinuousPlan(intervals)).toBe(false);
  });

  it('accepts a multi-band progression run — every bin is one stretch of running', () => {
    expect(isContinuousPlan(progression)).toBe(true);
  });

  it('cannot be decided from band geometry: the 4×2000 bands come back TOUCHING', () => {
    // This is the whole reason the check reads the steps. A 2 min recovery with no
    // pace target has no placeable length, so `buildPlannedBands` advances the
    // cursor not at all and the four reps land end-to-end. Any "are the bands
    // contiguous?" test therefore calls this interval session continuous — the
    // exact false positive that drew a km grid over reps and recovery jogs.
    const bands = buildPlannedBands(intervals);
    expect(bands.length).toBe(4);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].startM).toBe(bands[i - 1].endM);
    }
    // And the gap-based reading is no better: over a 1 km grid the nulls fall only
    // at the ends, where the unpaced warmup and cooldown are.
    const bins = projectBandsToBins(bands, Array(14).fill(1000));
    expect(bins.slice(2, 8).every((p) => p != null)).toBe(true);
  });

  it('ignores unpaced steps outside the targets — those bins just come back null', () => {
    const withBookends = wk([
      { type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'no_target' },
      { type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300 },
      { type: 'cooldown', durationType: 'distance', durationValue: 1000, targetType: 'no_target' },
    ]);
    expect(isContinuousPlan(withBookends)).toBe(true);
  });

  it('refuses an untargeted middle section — a band would absorb its metres', () => {
    const gapInside = wk([
      { type: 'active', durationType: 'distance', durationValue: 3000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300 },
      { type: 'active', durationType: 'distance', durationValue: 3000, targetType: 'no_target' },
      { type: 'active', durationType: 'distance', durationValue: 3000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 300 },
    ]);
    expect(isContinuousPlan(gapInside)).toBe(false);
  });

  it('refuses a plan with no paced step at all — there is no band to draw behind it', () => {
    const unpaced = wk([{ type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'no_target' }]);
    expect(isContinuousPlan(unpaced)).toBe(false);
  });
});
