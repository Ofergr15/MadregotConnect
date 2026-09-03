import { describe, expect, it } from 'vitest';
import { hasUsefulLaps, splitsToLaps, type StravaSplit } from '@/lib/strava/client';

const split = (n: number, extra: Partial<StravaSplit> = {}): StravaSplit => ({
  split: n,
  distance: 1000,
  moving_time: 300,
  elapsed_time: 305,
  average_speed: 1000 / 300,
  ...extra,
});

describe('splitsToLaps', () => {
  it('maps Strava per-km splits onto the lap shape the run card renders', () => {
    const laps = splitsToLaps([split(1, { average_heartrate: 150 }), split(2), split(3, { distance: 421, moving_time: 130 })]);
    expect(laps).toHaveLength(3);
    expect(laps[0]).toMatchObject({
      name: 'Split 1',
      lap_index: 1,
      split: 1,
      distance: 1000,
      moving_time: 300,
      elapsed_time: 305,
      average_heartrate: 150,
    });
    expect(laps[0].average_speed).toBeCloseTo(1000 / 300, 6);
    expect(laps[2].distance).toBe(421);
    expect('average_heartrate' in laps[1]).toBe(false);
  });

  it('derives speed when Strava omits it and drops junk entries', () => {
    const laps = splitsToLaps([
      split(1, { average_speed: 0 }),
      split(2, { distance: 0 }),
      { split: 3, distance: Number.NaN, moving_time: 10, elapsed_time: 10, average_speed: 1 },
      split(4),
    ]);
    expect(laps).toHaveLength(2);
    expect(laps[0].average_speed).toBeCloseTo(1000 / 300, 6);
    expect(laps.map((lap) => lap.lap_index)).toEqual([1, 2]);
  });

  it('returns nothing for missing, empty or single-split activities', () => {
    expect(splitsToLaps(undefined)).toEqual([]);
    expect(splitsToLaps(null)).toEqual([]);
    expect(splitsToLaps([])).toEqual([]);
    expect(splitsToLaps([split(1)])).toEqual([]);
  });
});

describe('hasUsefulLaps', () => {
  it('only treats two or more laps as a real breakdown', () => {
    expect(hasUsefulLaps(null)).toBe(false);
    expect(hasUsefulLaps([])).toBe(false);
    expect(hasUsefulLaps(splitsToLaps([split(1)]))).toBe(false);
    expect(hasUsefulLaps(splitsToLaps([split(1), split(2)]))).toBe(true);
  });
});
