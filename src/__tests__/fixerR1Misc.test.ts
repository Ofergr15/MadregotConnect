import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/academy/thread-server', () => ({ readThread: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

const { feedbackKeysOf } = await import('@/lib/academy/board-server');
const { lapsWhy } = await import('@/lib/academy/workout-extras');
const { recordOn } = await import('@/lib/academy/records');
const { buildLoadPayload } = await import('@/lib/academy/load-payload');
const { shiftDate } = await import('@/lib/academy/load');

// Round-1 fixer: issues 5, 19, 26, 27.

describe('an upgraded Strava run keeps its feedback (issue 19)', () => {
  it('the -strava key is the fallback after the run\'s own Garmin key', () => {
    expect(feedbackKeysOf({ garmin_activity_id: 4242, strava_activity_id: 7300001 })).toEqual([4242, -7300001]);
    expect(feedbackKeysOf({ garmin_activity_id: -7300001, strava_activity_id: 7300001 })).toEqual([-7300001]);
    expect(feedbackKeysOf({ garmin_activity_id: 99 })).toEqual([99]);
  });
});

describe('no laps, said for why (issue 27)', () => {
  it('manual, Strava still sending, Auto Lap off — and nothing when there are laps', () => {
    expect(lapsWhy({ source: 'manual', laps: null })).toBe('manual');
    expect(lapsWhy({ source: 'strava', laps: null })).toBe('stravaPending');
    expect(lapsWhy({ source: 'strava', laps: [] })).toBe('autoLapOff');
    expect(lapsWhy({ source: 'garmin', laps: [{ distance: 10000, duration: 3000 }] })).toBe('autoLapOff');
    expect(lapsWhy({ source: 'apple', laps: [{}, {}] })).toBeNull();
    expect(lapsWhy({ source: 'garmin', laps: null, splits: [{}, {}, {}] })).toBeNull();
  });
});

describe('a record against the whole season (issue 5)', () => {
  const km = (n: number, pace: number) => Array.from({ length: n }, () => ({ distance: 1000, duration: pace }));
  it('a 3:40 kilometre is no record when a 3:25 one is in the season, however many 5:20 runs came after it', () => {
    const today = '2026-10-13';
    const run = { id: 'y', start_time: `${shiftDate(today, -1)}T06:30:00`, distance: 5000, duration: 1300, laps: [...km(2, 330), { distance: 1000, duration: 220 }, ...km(2, 330)] };
    const old = { id: 'o', start_time: `${shiftDate(today, -330)}T06:30:00`, distance: 5000, duration: 1300, laps: [...km(2, 330), { distance: 1000, duration: 205 }, ...km(2, 330)] };
    const easy = Array.from({ length: 250 }, (_, i) => ({ id: `e${i}`, start_time: `${shiftDate(today, -2 - i)}T06:30:00`, distance: 10000, duration: 3200, laps: km(10, 320) }));
    expect(recordOn(run, [...easy, old])).toBeNull();
    // Only the newest 200 (the old cap): the 3:25 is out of the pool and 3:40 "beats" 5:20.
    expect(recordOn(run, easy.slice(0, 200))).toMatchObject({ bucket: '1k', previous: 320 });
  });
});

describe('the home\'s tomorrow number, said on 7 (issue 26)', () => {
  it('formTomorrow is today\'s load in, the home\'s "למחר"', () => {
    const today = '2026-10-13';
    const rows = Array.from({ length: 60 }, (_, i) => ({ date: shiftDate(today, -60 + i), load: i % 2 ? 80 : 0, source: 'pace' as const }));
    const p = buildLoadPayload({ rows, tests: [], today, range: '6w' });
    const t = buildLoadPayload({ rows, tests: [], today: shiftDate(today, 1), range: '6w' });
    expect(p.formTomorrow).toBe(t.today!.form);
  });
});
