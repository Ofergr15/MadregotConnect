import { describe, it, expect } from 'vitest';
import { flattenPlannedSteps, matchLapsToSteps, Lap } from '../lib/academy/segments';
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
