import { describe, it, expect } from 'vitest';
import {
  buildPlannedWorkout,
  assessWorkout,
  assessWeek,
  ActualActivity,
} from '../lib/academy/adherence';
import { ParsedWorkout, WorkoutStep } from '../lib/ai/types';

function workout(steps: Partial<WorkoutStep>[], extra: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return {
    dayOfWeek: 1,
    name: 'Test',
    steps: steps.map((s, i) => ({ order: i + 1, type: 'active', durationType: 'open', targetType: 'no_target', ...s } as WorkoutStep)),
    ...extra,
  };
}

describe('buildPlannedWorkout — planned metric extraction', () => {
  it('uses explicit coach distances (km) when present', () => {
    const p = buildPlannedWorkout(workout([], { distanceMinKm: 10, distanceMaxKm: 12 }), '2026-07-13');
    expect(p.distanceMin).toBe(10000);
    expect(p.distanceMax).toBe(12000);
  });

  it('sums step distances for a distance-based workout', () => {
    const p = buildPlannedWorkout(
      workout([
        { type: 'warmup', durationType: 'distance', durationValue: 2000 },
        { type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 240 },
      ]),
      '2026-07-13'
    );
    expect(p.distanceMin).toBe(7000);
    expect(p.distanceMax).toBe(7000);
  });

  it('extracts the work pace band from interval steps (ignoring warmup jog)', () => {
    const p = buildPlannedWorkout(
      workout([
        { type: 'warmup', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 330, targetPaceMaxPerKm: 360 },
        {
          type: 'interval', durationType: 'open', repeatCount: 5,
          repeatSteps: [
            { order: 1, type: 'interval', durationType: 'distance', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 195, targetPaceMaxPerKm: 200 } as WorkoutStep,
            { order: 2, type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' } as WorkoutStep,
          ],
        },
      ]),
      '2026-07-13'
    );
    expect(p.paceMin).toBe(195);
    expect(p.paceMax).toBe(200);
  });

  it('estimates duration from distance + pace', () => {
    const p = buildPlannedWorkout(
      workout([{ type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }]),
      '2026-07-13'
    );
    expect(p.durationSec).toBe(3000); // 10km * 300s/km
  });
});

describe('assessWorkout — per-metric status', () => {
  const planned = buildPlannedWorkout(
    workout([{ type: 'active', durationType: 'distance', durationValue: 10000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 310 }]),
    '2026-07-13'
  );

  it('missed workout: not completed, score 0', () => {
    const a = assessWorkout(planned, null);
    expect(a.completed).toBe(false);
    expect(a.score).toBe(0);
    expect(a.distance.status).toBe('unknown');
  });

  it('on-target run: distance/duration/pace all on target, score 1', () => {
    const actual: ActualActivity = {
      id: 'a1', date: '2026-07-13', distance: 10000, duration: 3000, movingDuration: 3000, averagePace: 300,
    };
    const a = assessWorkout(planned, actual);
    expect(a.completed).toBe(true);
    expect(a.distance.status).toBe('on_target');
    expect(a.pace.status).toBe('on_target');
    expect(a.score).toBe(1);
  });

  it('flags under-distance', () => {
    const actual: ActualActivity = { id: 'a2', date: '2026-07-13', distance: 6000, duration: 1800, averagePace: 300 };
    const a = assessWorkout(planned, actual);
    expect(a.distance.status).toBe('under');
  });

  it('flags slower pace beyond tolerance', () => {
    const actual: ActualActivity = { id: 'a3', date: '2026-07-13', distance: 10000, duration: 3600, averagePace: 360 };
    const a = assessWorkout(planned, actual);
    expect(a.pace.status).toBe('slower');
  });

  it('flags faster pace beyond tolerance', () => {
    const actual: ActualActivity = { id: 'a4', date: '2026-07-13', distance: 10000, duration: 2600, averagePace: 260 };
    const a = assessWorkout(planned, actual);
    expect(a.pace.status).toBe('faster');
  });

  it('pace within ±5s tolerance is on target (band 290-310, good 285-315)', () => {
    // 314 sec/km is within the slow bound 310 + 5 = 315.
    const actual: ActualActivity = { id: 'a5', date: '2026-07-13', distance: 10000, duration: 3140, averagePace: 314 };
    const a = assessWorkout(planned, actual);
    expect(a.pace.status).toBe('on_target');
  });

  it('pace-seconds example: 5:00 target ±5s → 4:55 ok, 4:50 too fast, 5:06 too slow', () => {
    // Single target 300 s/km (5:00), default ±5s → good 295..305.
    const p = buildPlannedWorkout(
      workout([{ type: 'active', durationType: 'distance', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }]),
      '2026-07-13'
    );
    const at = (pace: number) => assessWorkout(p, { id: 'x', date: '2026-07-13', distance: 2000, duration: 2 * pace, averagePace: pace }).pace.status;
    expect(at(295)).toBe('on_target'); // 4:55
    expect(at(305)).toBe('on_target'); // 5:05
    expect(at(290)).toBe('faster');    // 4:50
    expect(at(306)).toBe('slower');    // 5:06
  });
});

describe('assessWeek — matching + rollup', () => {
  const planned = [
    buildPlannedWorkout(workout([{ type: 'active', durationType: 'distance', durationValue: 8000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }], { name: 'Mon Easy' }), '2026-07-13'),
    buildPlannedWorkout(workout([{ type: 'active', durationType: 'distance', durationValue: 12000, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 290 }], { name: 'Wed Long' }), '2026-07-15'),
  ];

  it('matches activities by date and rolls up completion', () => {
    const activities: ActualActivity[] = [
      { id: 'x1', date: '2026-07-13', distance: 8000, duration: 2400, movingDuration: 2400, averagePace: 300 },
      // nothing on 07-15 → missed
    ];
    const week = assessWeek(planned, activities);
    expect(week.plannedCount).toBe(2);
    expect(week.completedCount).toBe(1);
    expect(week.completionRate).toBe(0.5);
    expect(week.workouts[0].completed).toBe(true);
    expect(week.workouts[1].completed).toBe(false);
  });

  it('does not reuse the same activity for two planned workouts on the same day', () => {
    const samedayPlan = [
      buildPlannedWorkout(workout([{ type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }], { name: 'AM' }), '2026-07-13'),
      buildPlannedWorkout(workout([{ type: 'active', durationType: 'distance', durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }], { name: 'PM' }), '2026-07-13'),
    ];
    const activities: ActualActivity[] = [
      { id: 'only', date: '2026-07-13', distance: 5000, duration: 1500, averagePace: 300 },
    ];
    const week = assessWeek(samedayPlan, activities);
    expect(week.completedCount).toBe(1); // one matched, the other missed
  });

  it('picks the same-day activity closest to planned distance', () => {
    const activities: ActualActivity[] = [
      { id: 'short', date: '2026-07-15', distance: 3000, duration: 900, averagePace: 300 },
      { id: 'long', date: '2026-07-15', distance: 12000, duration: 3480, averagePace: 290 },
    ];
    const week = assessWeek([planned[1]], activities);
    expect(week.workouts[0].actual?.id).toBe('long');
  });
});
