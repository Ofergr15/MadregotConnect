import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/quality-session/server', () => ({ loadQualityWorkout: async () => null }));
import { packPaces, repTarget } from '@/lib/activities/rep-target';
import { longestPerDay } from '@/lib/activities/quality-name';
import { displayRunName } from '@/lib/activities/run-name';

// The run page's reps-vs-target and the quality session's name (mockup run-page-b).

describe('the reps\' target, from the workout on the watch', () => {
  it('reads the club\'s notation: pack 1 plain, pack 2 (), pack 3 (())', () => {
    expect(packPaces('3:15 (3:25) ((3:35))')).toEqual([195, 205, 215]);
    expect(packPaces('4:40–5:15')).toEqual([298, null, null]);
  });
  it('takes the repeated distance step, for the runner\'s own pack', () => {
    const ex = { steps: [
      { stepIndex: 0, notes: '4:40–5:15', durationType: 'TIME' },
      { stepIndex: 1, notes: '3:15 (3:25) ((3:35))', distanceM: 200, durationType: 'DISTANCE' },
      { stepIndex: 2, notes: 'הליכה', distanceM: 100, durationType: 'DISTANCE' },
      { stepIndex: 3, iterations: 15, repeatFrom: 1, durationType: 'REPEAT_UNTIL_STEPS_CMPLT' },
    ] };
    expect(repTarget(ex, 1)).toEqual({ pace: 205, min: 195, max: 215, meters: 200, reps: 15 });
    expect(repTarget(ex, 2)?.pace).toBe(215);
    expect(repTarget({ steps: [{ stepIndex: 0, notes: '5:00', durationType: 'TIME' }] }, 0)).toBeNull();
  });
});

describe('the quality session\'s name', () => {
  it('goes to each runner\'s longest run of the day', () => {
    const m = longestPerDay([
      { id: 'a', athlete_id: 'x', start_time: '2026-10-18T06:00:00', distance: 3000 },
      { id: 'b', athlete_id: 'x', start_time: '2026-10-18T08:45:00', distance: 16029 },
      { id: 'c', athlete_id: 'y', start_time: '2026-10-18T07:00:00', distance: 8000 },
    ]);
    expect([...m.keys()].sort()).toEqual(['b', 'c']);
  });
  it('replaces the watch\'s name, never one the runner typed; everyone else: Strava\'s time of day', () => {
    expect(displayRunName('Morning Run', '2026-10-18T08:45:00', 'he', '50 דק׳ + 15 × 200')).toBe('50 דק׳ + 15 × 200');
    expect(displayRunName('Tel Aviv Running', '2026-10-18T08:45:00', 'he', 'אינטרוולים')).toBe('אינטרוולים');
    expect(displayRunName('ריצה עם החבר׳ה', '2026-10-18T08:45:00', 'he', 'אינטרוולים')).toBe('ריצה עם החבר׳ה');
    expect(displayRunName('Morning Run', '2026-10-18T08:45:00', 'he')).toBe('ריצת בוקר');
  });
});
