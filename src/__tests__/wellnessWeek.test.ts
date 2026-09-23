import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withWellness, type Last7Report } from '@/lib/reports/last-7-days';
import { availableMetrics, defaultMetricKeys } from '@/lib/reports/week-share';
import { daysBefore, missingNights, LOOKBACK_DAYS } from '@/lib/wellness/sweep';

const base: Last7Report = {
  days: [], from: '2026-09-13', to: '2026-09-19',
  km: 40, seconds: 12000, runs: 4, elevation: 0, calories: 0, paceSeconds: 300,
};

describe('withWellness (#69)', () => {
  it('averages over the recorded nights only, inside the window', () => {
    const r = withWellness(base, [
      { date: '2026-09-12', sleep_seconds: 1000, resting_hr: 90 }, // before the window
      { date: '2026-09-14', sleep_seconds: 7 * 3600, resting_hr: 48 },
      { date: '2026-09-15', sleep_seconds: null, resting_hr: null }, // watch off
      { date: '2026-09-16', sleep_seconds: 6 * 3600, resting_hr: 50 },
    ]);
    expect(r.sleepSeconds).toBe(6.5 * 3600);
    expect(r.restingHr).toBe(49);
  });

  it('no nights: both stay null and the card offers neither row', () => {
    const r = withWellness(base, []);
    expect(r.sleepSeconds).toBeNull();
    expect(availableMetrics(r).map(m => m.key)).not.toContain('sleep');
    expect(availableMetrics(r).map(m => m.key)).not.toContain('rhr');
  });

  it('with data, sleep and resting HR are on the shared card by default', () => {
    const r = withWellness(base, [{ date: '2026-09-14', sleep_seconds: 25200, resting_hr: 48 }]);
    expect(defaultMetricKeys(r)).toEqual(expect.arrayContaining(['sleep', 'rhr']));
    expect(availableMetrics(r).find(m => m.key === 'sleep')!.total(r)).toBe('7:00');
  });
});

describe('nightly sweep window', () => {
  it('asks only for nights with nothing stored', () => {
    const today = '2026-09-23';
    const nights = missingNights(today, [
      { date: '2026-09-23', sleep_seconds: 20000, resting_hr: 50 },
      { date: '2026-09-22', sleep_seconds: null, resting_hr: null }, // retried
    ]);
    expect(nights).toHaveLength(LOOKBACK_DAYS - 1);
    expect(nights[0]).toBe('2026-09-22');
    expect(nights).not.toContain('2026-09-23');
    expect(nights[nights.length - 1]).toBe(daysBefore(today, LOOKBACK_DAYS - 1));
  });

  it('is scheduled, and health data is only folded into your own profile', () => {
    expect(readFileSync('vercel.json', 'utf8')).toMatch(/"\/api\/cron\/wellness"/);
    expect(readFileSync('src/app/api/athletes/[id]/stats/route.ts', 'utf8')).toMatch(/caller\.athleteId === id\s*\n?\s*\? withWellness/);
    expect(readFileSync('src/app/api/wellness/route.ts', 'utf8')).toMatch(/auth\.user\.athleteId/);
  });
});
