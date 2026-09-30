import { describe, expect, it } from 'vitest';
import { buildLast7Report, withWellness } from '@/lib/reports/last-7-days';
import {
  LOOK_CAP, NUMBER_ORDER, availableLooks, availableNumbers, bodyDelta, initialStoryState,
  nightlySleep, numberValue, swapNumbers, toggleNumber,
} from '@/lib/reports/week-story';

/**
 * The weekly story editor's rules (weekly-summary-app.html, version C): each look
 * has its own room and its own pick, the tray never reorders, a drag swaps.
 */
const run = (date: string, km: number, extra: Record<string, number> = {}) => ({
  activity_type: 'running', start_time: `${date}T05:00:00Z`, distance: km * 1000, duration: km * 330, ...extra,
});
const plain = buildLast7Report([run('2026-09-21', 10), run('2026-09-24', 8)], '2026-09-26');
const watched = withWellness(
  buildLast7Report([run('2026-09-21', 10, { elevation_gain: 80, calories: 700 })], '2026-09-26'),
  [
    { date: '2026-09-21', sleep_seconds: 7 * 3600, resting_hr: 45 },
    { date: '2026-09-22', sleep_seconds: 8 * 3600, resting_hr: 43 },
  ],
);

describe('what is on offer', () => {
  it('a watchless week has no sleep, no resting HR and no body look', () => {
    expect(availableNumbers(plain)).toEqual(['km', 'runs', 'time', 'pace']);
    expect(availableLooks(plain)).not.toContain('body');
  });

  it('a Garmin week offers everything, in the fixed tray order', () => {
    expect(availableNumbers(watched)).toEqual(NUMBER_ORDER);
    expect(availableLooks(watched)).toContain('body');
  });

  it('every look opens within its room, with numbers the week really has', () => {
    const s = initialStoryState(plain, 'he');
    for (const [look, keys] of Object.entries(s.picks)) {
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(LOOK_CAP[look as keyof typeof LOOK_CAP]);
      keys.forEach(k => expect(availableNumbers(plain)).toContain(k));
    }
  });
});

describe('the tray', () => {
  it('a tap adds while there is room and never removes the last number', () => {
    expect(toggleNumber(['km'], 'runs', 3)).toEqual(['km', 'runs']);
    expect(toggleNumber(['km', 'runs', 'pace'], 'time', 3)).toEqual(['km', 'runs', 'pace']);
    expect(toggleNumber(['km'], 'km', 3)).toEqual(['km']);
    expect(toggleNumber(['km', 'runs'], 'km', 3)).toEqual(['runs']);
  });

  it('a look with room for one number swaps it on a tap, so another can ever be picked', () => {
    expect(toggleNumber(['km'], 'runs', 1)).toEqual(['runs']);
    expect(toggleNumber(['km'], 'km', 1)).toEqual(['km']);
  });

  it('a drag swaps two places and moves nothing else', () => {
    expect(swapNumbers(['km', 'runs', 'time', 'pace'], 'km', 'pace')).toEqual(['pace', 'runs', 'time', 'km']);
    expect(swapNumbers(['km', 'runs'], 'km', 'elev')).toEqual(['km', 'runs']);
  });
});

describe('the numbers', () => {
  it('prints the card values', () => {
    expect(numberValue(plain, 'km')).toBe('18.0');
    expect(numberValue(plain, 'pace')).toBe('5:30');
    expect(numberValue(watched, 'sleep')).toBe('7:30');
    expect(numberValue(watched, 'rhr')).toBe('44');
  });

  it('body deltas point the way a runner hopes: more sleep, lower resting HR', () => {
    const prev = { ...watched, sleepSeconds: 7 * 3600, restingHr: 46 };
    expect(bodyDelta(watched, prev, 'sleep')).toEqual({ text: '+0:30', good: true });
    expect(bodyDelta(watched, prev, 'rhr')).toEqual({ text: '↓ 2', good: true });
    expect(bodyDelta(watched, null, 'rhr')).toBeNull();
    expect(bodyDelta(watched, { ...prev, restingHr: null }, 'rhr')).toBeNull();
  });

  it('the sleep strip has one slot per day, empty where the watch was off', () => {
    const s = nightlySleep(watched, [{ date: '2026-09-22', sleep_seconds: 28800, resting_hr: null }]);
    expect(s).toHaveLength(7);
    expect(s.filter(x => x !== null)).toEqual([28800]);
  });
});
