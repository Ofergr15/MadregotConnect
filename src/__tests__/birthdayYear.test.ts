import { describe, expect, it } from 'vitest';
import { computeYearStats, timesInWords, yearWindow, type YearActivityRow } from '@/lib/birthday-year/stats';
import { storyBirthday } from '@/lib/birthday-year/server';

/**
 * "השנה שלך" — the birthday year story. The numbers have to be the athlete's own: the same
 * days they would name, the same streak they remember, and the race time they ran.
 */

let seq = 0;
const run = (day: string, km: number, over: Partial<YearActivityRow> = {}): YearActivityRow => ({
  id: `a${++seq}`,
  start_time: `${day}T07:10:00+00:00`,
  distance: km * 1000,
  duration: km * 280,
  activity_type: 'running',
  activity_name: 'ריצה',
  elevation_gain: 20,
  calories: km * 70,
  ...over,
});

describe('the window', () => {
  it('runs from the last birthday to the day before this one', () => {
    expect(yearWindow('2026-10-18')).toEqual({ from: '2025-10-18', to: '2026-10-17' });
  });

  it('opens a story on the birthday, keeps it a week, and previews the next one for the admin', () => {
    expect(storyBirthday('1990-10-18', '2026-10-18')).toBe('2026-10-18');
    expect(storyBirthday('1990-10-18', '2026-10-25')).toBe('2026-10-18');
    expect(storyBirthday('1990-10-18', '2026-10-26')).toBeNull();
    expect(storyBirthday('1990-10-18', '2026-10-10')).toBeNull();
    expect(storyBirthday('1990-10-18', '2026-10-10', { preview: true })).toBe('2026-10-18');
  });
});

describe('the year in numbers', () => {
  const w = { from: '2025-10-18', to: '2026-10-17' };

  it('counts runs, days, rest days and the longest unbroken streak', () => {
    const rows = [
      run('2026-01-01', 10), run('2026-01-02', 10), run('2026-01-03', 10), run('2026-01-03', 5, { start_time: '2026-01-03T18:00:00+00:00' }),
      run('2026-01-05', 12), run('2026-01-06', 12),
    ];
    const s = computeYearStats(rows, w);
    expect(s.runs).toBe(6);
    expect(s.runDates).toHaveLength(5);
    expect(s.restDays).toBe(365 - 5);
    expect(s.streak).toEqual({ days: 3, from: '2026-01-01', to: '2026-01-03' });
    expect(s.doubleDays).toBe(1);
    expect(s.km).toBe(59);
  });

  it('counts one run recorded twice once, keeping the longer recording', () => {
    const s = computeYearStats([
      run('2026-09-27', 42.4, { duration: 9107, start_time: '2026-09-27T08:45:00+00:00' }),
      run('2026-09-27', 37.1, { duration: 9602, start_time: '2026-09-27T08:46:00+00:00' }),
      run('2026-09-28', 5, { start_time: '2026-09-28T07:00:00+00:00' }),
    ], w);
    expect(s.runs).toBe(2);
    expect(s.km).toBe(47);
    expect(s.longest).toMatchObject({ km: 42.4 });
  });

  it('leaves out what is not a run, and what falls outside the year', () => {
    const s = computeYearStats([
      run('2026-02-01', 10), run('2026-02-02', 30, { activity_type: 'cycling' }),
      run('2025-10-17', 10), run('2026-10-18', 10),
    ], w);
    expect(s.runs).toBe(1);
  });

  it('puts every kilometre in its calendar month and names the best one', () => {
    const s = computeYearStats([run('2026-08-01', 20), run('2026-08-15', 20), run('2026-03-01', 15)], w);
    expect(s.months).toHaveLength(13);
    expect(s.months.find((m) => m.ym === '2026-08')!.km).toBe(40);
    expect(s.bestMonth).toEqual({ ym: '2026-08', km: 40 });
  });

  it('splits outside and treadmill runs, and finds the longest run', () => {
    const s = computeYearStats([run('2026-05-01', 51.1), run('2026-05-02', 8, { activity_type: 'treadmill_running' })], w);
    expect(s.outdoor).toBe(1);
    expect(s.treadmill).toBe(1);
    expect(s.longest).toMatchObject({ km: 51.1, date: '2026-05-01' });
    expect(s.over30).toBe(1);
  });

  it('makes the year\'s marathon the run of the year, with its route and its own time', () => {
    const route = [{ lat: 52.51, lng: 13.36 }, { lat: 52.5, lng: 13.4 }, { lat: 52.52, lng: 13.41 }];
    const s = computeYearStats([run('2026-09-27', 42.4, { duration: 9107, route_preview_hd: route }), run('2026-09-01', 10)], w);
    expect(s.moment).toMatchObject({ key: 'fm', date: '2026-09-27', km: 42.4, seconds: 9107 });
    expect(s.bests.find((b) => b.key === 'fm')).toBeTruthy();
  });

  it('has no run of the year without a race-length run that has a route', () => {
    const s = computeYearStats([run('2026-09-27', 42.4, { route_preview_hd: [] })], w);
    expect(s.moment).toBeNull();
  });
});

describe('the comparisons in words', () => {
  it('rounds to the nearest half', () => {
    expect(timesInWords(2.49)).toBe('פעמיים וחצי');
    expect(timesInWords(2.1)).toBe('פעמיים');
    expect(timesInWords(1.4)).toBe('פעם וחצי');
    expect(timesInWords(1)).toBe('פעם אחת');
    expect(timesInWords(3.6)).toBe('3 וחצי פעמים');
  });
});
