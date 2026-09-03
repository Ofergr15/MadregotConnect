import { describe, expect, it } from 'vitest';
import { formatMeasure, measureFor, workoutFromLaps } from '@/lib/run-chat/workout-from-laps';
import { expandWorkoutSteps } from '@/lib/run-chat/mock-workout';
import { intensityLayout } from '@/lib/run-chat/clipboard-layout';
import type { StravaLap } from '@/lib/strava/client';

let counter = 0;
const lap = (moving_time: number, distance: number, hr?: number): StravaLap => {
  counter += 1;
  return {
    name: `Lap ${counter}`,
    lap_index: counter,
    moving_time,
    elapsed_time: moving_time,
    distance,
    average_speed: distance / moving_time,
    ...(hr ? { average_heartrate: hr } : {}),
  };
};

const REPORTED_RUN: StravaLap[] = [
  lap(600, 1580, 119),
  lap(600, 2100, 147),
  lap(600, 2330, 166),
  lap(600, 2400, 173),
  lap(300, 223, 120),
  lap(30, 132, 139), lap(60, 75, 150),
  lap(30, 127, 144), lap(60, 85, 152),
  lap(30, 129, 147), lap(60, 102, 150),
  lap(30, 123, 142), lap(60, 80, 151),
  lap(30, 129, 143), lap(60, 81, 150),
  lap(30, 114, 138), lap(60, 88, 152),
  lap(2, 3, 136),
];

describe('measureFor', () => {
  it('prefers a round time when the distance is not round', () => {
    expect(measureFor(600, 2330)).toEqual({ durationSec: 600 });
    expect(measureFor(31, 127)).toEqual({ durationSec: 30 });
    expect(measureFor(301, 223)).toEqual({ durationSec: 300 });
  });

  it('prefers a round distance when the time is not round', () => {
    expect(measureFor(238, 1002)).toEqual({ distanceM: 1000 });
    expect(measureFor(83, 403)).toEqual({ distanceM: 400 });
    expect(measureFor(660, 2010)).toEqual({ distanceM: 2000 });
  });

  it('falls back to a rounded distance for long laps and rounded time for short ones', () => {
    expect(measureFor(733, 2470)).toEqual({ distanceM: 2500 });
    expect(measureFor(47, 173)).toEqual({ durationSec: 50 });
  });

  it('formats measures the way the clipboard does', () => {
    expect(formatMeasure({ distanceM: 1000 })).toBe('1 km');
    expect(formatMeasure({ distanceM: 1500 })).toBe('1.5 km');
    expect(formatMeasure({ distanceM: 400 })).toBe('400 m');
    expect(formatMeasure({ durationSec: 600 })).toBe('10 min');
    expect(formatMeasure({ durationSec: 30 })).toBe('0:30');
  });
});

describe('workoutFromLaps', () => {
  it('reverse-engineers the reported run into warmup, builds, walk and a 6× set', () => {
    const workout = workoutFromLaps({ id: 'a1', distance: 9894, duration: 3242 }, REPORTED_RUN);
    expect(workout).not.toBeNull();
    const kinds = workout!.segments.map((s) => s.kind);
    expect(kinds).toEqual(['warmup', 'interval', 'interval', 'interval', 'recovery', 'repeat']);

    expect(workout!.segments[0]).toMatchObject({ kind: 'warmup', durationSec: 600, detail: '10 min' });
    expect(workout!.segments[1]).toMatchObject({ kind: 'interval', durationSec: 600, targetPaceSec: 285 });
    expect(workout!.segments[3]).toMatchObject({ kind: 'interval', durationSec: 600, targetPaceSec: 250 });
    expect(workout!.segments[4]).toMatchObject({ kind: 'recovery', durationSec: 300, note: 'הליכה' });

    const repeat = workout!.segments[5];
    expect(repeat.reps).toBe(6);
    expect(repeat.steps).toHaveLength(2);
    expect(repeat.steps![0]).toMatchObject({ kind: 'interval', durationSec: 30 });
    // 754 m in 180 s across the six efforts → 3:59/km, rounded to 5 s
    expect(repeat.steps![0].targetPaceSec).toBe(240);
    expect(repeat.steps![1]).toMatchObject({ kind: 'recovery', durationSec: 60, note: 'הליכה' });

    expect(workout!.title).toBe('6×0:30');
    expect(workout!.prompt).toBe(
      '10 דק׳ חימום + 10 דק׳ בקצב 4:45 + 10 דק׳ בקצב 4:20 + 10 דק׳ בקצב 4:10 + 5 דק׳ הליכה + 6×(0:30 בקצב 4:00 / 1 דק׳ הליכה)',
    );
    expect(workout!.source).toEqual({ matchMethod: 'laps', activityId: 'a1' });
  });

  it('produces a plan the clipboard can render', () => {
    const workout = workoutFromLaps({ distance: 9894, duration: 3242 }, REPORTED_RUN)!;
    const steps = expandWorkoutSteps(workout);
    expect(steps).toHaveLength(5 + 12);
    const bars = intensityLayout(steps, 350);
    expect(bars).toHaveLength(17);
    expect(bars.every((bar) => bar.width > 0)).toBe(true);
  });

  it('recognises the classic 2 km warmup, 5×(1 km / 1 km), cooldown session', () => {
    const laps = [
      lap(690, 2000, 130),
      ...Array.from({ length: 5 }, () => [lap(238, 1000, 170), lap(330, 1000, 145)]).flat(),
      lap(620, 1800, 135),
    ];
    const workout = workoutFromLaps({ distance: 13800, duration: 4150 }, laps)!;
    expect(workout.segments.map((s) => s.kind)).toEqual(['warmup', 'repeat', 'cooldown']);
    expect(workout.segments[0]).toMatchObject({ distanceM: 2000, detail: '2 km' });
    expect(workout.segments[1]).toMatchObject({ reps: 5 });
    expect(workout.segments[1].steps![0]).toMatchObject({ kind: 'interval', distanceM: 1000, targetPaceSec: 240 });
    expect(workout.segments[1].steps![1]).toMatchObject({ kind: 'recovery', distanceM: 1000, note: 'קל' });
    expect(workout.segments[2]).toMatchObject({ kind: 'cooldown', distanceM: 1800 });
    expect(workout.title).toBe('5×1 km');
    expect(workout.prompt).toBe('2 ק״מ חימום + 5×(1 ק״מ בקצב 4:00 / 1 ק״מ קל) + 1.8 ק״מ שחרור');
  });

  it('merges consecutive slow opening laps into one warmup', () => {
    const laps = [
      lap(330, 1000), lap(325, 1000),
      ...Array.from({ length: 4 }, () => [lap(80, 400), lap(110, 200)]).flat(),
    ];
    const workout = workoutFromLaps({}, laps)!;
    expect(workout.segments[0]).toMatchObject({ kind: 'warmup', distanceM: 2000 });
    expect(workout.segments[1]).toMatchObject({ kind: 'repeat', reps: 4 });
  });

  it('turns an even-paced run into a single steady segment', () => {
    const laps = Array.from({ length: 10 }, (_, i) => lap(300 + (i % 2) * 4, 1000));
    const workout = workoutFromLaps({}, laps)!;
    expect(workout.segments).toHaveLength(1);
    expect(workout.segments[0]).toMatchObject({ kind: 'easy', distanceM: 10000, targetPaceSec: 300 });
    expect(workout.title).toBe('ריצה 10 ק״מ');
  });

  it('returns null when there is nothing to learn from', () => {
    expect(workoutFromLaps({}, null)).toBeNull();
    expect(workoutFromLaps({}, [])).toBeNull();
    expect(workoutFromLaps({}, [lap(3242, 9894)])).toBeNull();
    expect(workoutFromLaps({}, [lap(5, 10), lap(4, 8)])).toBeNull();
  });
});
