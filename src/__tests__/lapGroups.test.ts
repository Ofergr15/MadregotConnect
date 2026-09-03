import { describe, expect, it } from 'vitest';
import { groupLaps, lapsMatch } from '@/lib/run-chat/lap-groups';
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

/** The real Strava run from the bug report: 4×10:00 build, 5:00 walk, 6×(0:30 fast / 1:00 walk), 0:02 tail. */
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

describe('lapsMatch', () => {
  it('matches laps cut by the same time or the same distance', () => {
    expect(lapsMatch(lap(30, 132), lap(30, 114))).toBe(true);
    expect(lapsMatch(lap(245, 1000), lap(262, 1001))).toBe(true);
    expect(lapsMatch(lap(30, 132), lap(60, 85))).toBe(false);
  });

  it('can additionally require a similar pace', () => {
    expect(lapsMatch(lap(240, 1000), lap(330, 1000), true)).toBe(false);
    expect(lapsMatch(lap(240, 1000), lap(250, 1000), true)).toBe(true);
  });
});

describe('groupLaps', () => {
  it('collapses the reported run into singles + one 6× block', () => {
    const blocks = groupLaps(REPORTED_RUN);
    expect(blocks.map((b) => b.kind)).toEqual(['lap', 'lap', 'lap', 'lap', 'lap', 'repeat', 'lap']);
    const repeat = blocks[5];
    if (repeat.kind !== 'repeat') throw new Error('expected repeat');
    expect(repeat.reps).toBe(6);
    expect(repeat.fromLap).toBe(6);
    expect(repeat.toLap).toBe(17);
    expect(repeat.steps).toHaveLength(2);
    expect(repeat.steps[0]).toMatchObject({ count: 6, durationSec: 30 });
    expect(repeat.steps[0].distanceM).toBeCloseTo(128, 0);
    expect(repeat.steps[0].lapNumbers).toEqual([6, 8, 10, 12, 14, 16]);
    expect(repeat.steps[1]).toMatchObject({ count: 6, durationSec: 60 });
    expect(repeat.steps[1].lapNumbers).toEqual([7, 9, 11, 13, 15, 17]);
    expect(repeat.steps[0].paceSecPerKm).toBeLessThan(repeat.steps[1].paceSecPerKm!);
    expect(repeat.steps[0].averageHr).toBeCloseTo(142.2, 0);
  });

  it('does not merge a progression of equal-time laps at different paces', () => {
    const blocks = groupLaps([lap(600, 1580), lap(600, 2100), lap(600, 2330), lap(600, 2400)]);
    expect(blocks.every((b) => b.kind === 'lap')).toBe(true);
  });

  it('collapses 10 × 1 km at a steady pace into a single-step block', () => {
    const laps = Array.from({ length: 10 }, (_, i) => lap(240 + (i % 3), 1000 + (i % 2) * 3, 160));
    const blocks = groupLaps(laps);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'repeat', reps: 10, fromLap: 1, toLap: 10 });
  });

  it('collapses 5 × (1 km fast / 1 km slow) with warmup and cooldown around it', () => {
    const laps = [
      lap(660, 2000, 130),
      ...Array.from({ length: 5 }, () => [lap(238, 1000, 170), lap(330, 1000, 145)]).flat(),
      lap(600, 1800, 135),
    ];
    const blocks = groupLaps(laps);
    expect(blocks.map((b) => b.kind)).toEqual(['lap', 'repeat', 'lap']);
    const repeat = blocks[1];
    if (repeat.kind !== 'repeat') throw new Error('expected repeat');
    expect(repeat.reps).toBe(5);
    expect(repeat.steps.map((s) => s.distanceM)).toEqual([1000, 1000]);
  });

  it('handles three-step patterns (400 fast / 200 jog / 200 walk)', () => {
    const laps = Array.from({ length: 4 }, () => [lap(80, 400), lap(70, 200), lap(120, 200)]).flat();
    const blocks = groupLaps(laps);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'repeat', reps: 4 });
    if (blocks[0].kind === 'repeat') expect(blocks[0].steps).toHaveLength(3);
  });

  it('leaves short runs and non-repeating laps untouched', () => {
    expect(groupLaps([])).toEqual([]);
    const blocks = groupLaps([lap(300, 1000), lap(300, 1000)]);
    expect(blocks.every((b) => b.kind === 'lap')).toBe(true);
    const mixed = groupLaps([lap(30, 130), lap(60, 80), lap(30, 130), lap(60, 80)]);
    expect(mixed.every((b) => b.kind === 'lap')).toBe(true);
  });

  it('requires only two reps when asked', () => {
    const blocks = groupLaps([lap(30, 130), lap(60, 80), lap(30, 130), lap(60, 80)], { minReps: 2 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'repeat', reps: 2 });
  });
});
