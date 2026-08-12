import { describe, expect, it } from 'vitest';
import {
  activitySummary,
  compareRuns,
  lapAnalysis,
  similarRunScore,
  type RunActivity,
} from '@/lib/run-chat/run-analysis';

const activity = (overrides: Partial<RunActivity> = {}): RunActivity => ({
  id: 'run-1',
  activity_name: 'Intervals',
  start_time: '2026-08-11T06:00:00Z',
  distance: 3000,
  duration: 720,
  moving_duration: 720,
  average_pace: 240,
  average_hr: 160,
  max_hr: 180,
  elevation_gain: 20,
  strava_activity_id: 123,
  laps: [
    {
      name: 'Lap 1',
      distance: 1000,
      moving_time: 250,
      average_speed: 4,
      average_heartrate: 150,
      max_heartrate: 165,
      lap_index: 1,
    },
    {
      name: 'Lap 2',
      distance: 1000,
      moving_time: 230,
      average_speed: 4.35,
      average_heartrate: 160,
      max_heartrate: 175,
      lap_index: 2,
    },
    {
      name: 'Lap 3',
      distance: 1000,
      moving_time: 240,
      average_speed: 4.17,
      average_heartrate: 170,
      max_heartrate: 180,
      lap_index: 3,
    },
  ],
  ...overrides,
});

describe('run analysis tools', () => {
  it('normalizes the activity summary', () => {
    expect(activitySummary(activity())).toMatchObject({
      distance_km: 3,
      pace: '4:00/km',
      lap_count: 3,
    });
  });

  it('finds fastest lap and heart-rate drift', () => {
    const result = lapAnalysis(activity());
    expect(result.analysis.fastest_lap?.lap).toBe(2);
    expect(result.analysis.slowest_lap?.lap).toBe(1);
    expect(result.analysis.pace_spread_s_per_km).toBe(20);
    expect(result.analysis.heart_rate_drift_bpm).toBe(15);
  });

  it('compares pace and heart rate using current-minus-comparison deltas', () => {
    const result = compareRuns(
      activity({ average_pace: 235, average_hr: 162 }),
      activity({ id: 'run-2', average_pace: 245, average_hr: 158 }),
    );
    expect(result.delta_current_minus_comparison.pace_s_per_km).toBe(-10);
    expect(result.delta_current_minus_comparison.average_hr).toBe(4);
  });

  it('ranks a structurally similar run above a different run', () => {
    const current = activity();
    const similar = activity({ id: 'similar', distance: 3100, average_pace: 242 });
    const different = activity({ id: 'different', distance: 15000, average_pace: 360, laps: [] });
    expect(similarRunScore(current, similar)).toBeGreaterThan(similarRunScore(current, different));
  });
});
