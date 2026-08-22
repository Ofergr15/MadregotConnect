import { describe, expect, it } from 'vitest';
import { computeMetricValue } from '@/lib/challenges/engine';

function run(startTime: string, distance: number, duration = 1800, elevation = 0, activityType = 'running') {
  return { start_time: startTime, distance, duration, elevation_gain: elevation, activity_type: activityType };
}

describe('computeMetricValue', () => {
  const WINDOW_START = '2026-08-01';
  const WINDOW_END = '2026-08-31';

  it('sums distance in km for qualifying runs within the window', () => {
    const activities = [
      run('2026-08-05T06:00:00Z', 5000),
      run('2026-08-15T06:00:00Z', 10000),
    ];
    expect(computeMetricValue('distance_km', activities, WINDOW_START, WINDOW_END)).toBe(15);
  });

  it('counts qualifying runs within the window', () => {
    const activities = [
      run('2026-08-05T06:00:00Z', 5000),
      run('2026-08-15T06:00:00Z', 10000),
      run('2026-08-20T06:00:00Z', 3000),
    ];
    expect(computeMetricValue('workout_count', activities, WINDOW_START, WINDOW_END)).toBe(3);
  });

  it('sums elevation gain for qualifying runs within the window', () => {
    const activities = [run('2026-08-05T06:00:00Z', 5000, 1800, 120), run('2026-08-15T06:00:00Z', 10000, 3600, 80)];
    expect(computeMetricValue('elevation_m', activities, WINDOW_START, WINDOW_END)).toBe(200);
  });

  it('excludes activities outside the window (boundary is inclusive)', () => {
    const activities = [
      run('2026-07-31T23:00:00Z', 5000), // day before window (local date still 07-31)
      run('2026-08-01T00:00:00Z', 4000), // exactly window start
      run('2026-08-31T23:59:00Z', 6000), // exactly window end
      run('2026-09-01T00:00:00Z', 7000), // day after window
    ];
    expect(computeMetricValue('distance_km', activities, WINDOW_START, WINDOW_END)).toBe(10);
  });

  it('excludes non-qualifying activities (zero distance, or a non-run type)', () => {
    const activities = [
      run('2026-08-05T06:00:00Z', 0), // zero distance
      run('2026-08-06T06:00:00Z', 5000, 1800, 0, 'walking'), // not a run type
      run('2026-08-07T06:00:00Z', 5000),
    ];
    expect(computeMetricValue('workout_count', activities, WINDOW_START, WINDOW_END)).toBe(1);
  });

  it('returns 0 for an empty activity list', () => {
    expect(computeMetricValue('distance_km', [], WINDOW_START, WINDOW_END)).toBe(0);
  });
});
