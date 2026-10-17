import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { buildLast7Report } from '@/lib/reports/last-7-days';

/**
 * TAP A DAY, GET THE RUN (feedback #94) — for everyone since 2026-10-16.
 */
describe('a day on the profile opens its run', () => {
  it('carries the day\'s runs, longest first, and nothing on a rest day', () => {
    const r = buildLast7Report([
      { id: 'short', start_time: '2026-09-29T04:00:00Z', distance: 3000, duration: 900 },
      { id: 'long', start_time: '2026-09-29T15:00:00Z', distance: 11000, duration: 3300 },
      { start_time: '2026-09-28T04:00:00Z', distance: 5000, duration: 1500 },
    ], '2026-09-30');
    const tue = r.days.find(d => d.date === '2026-09-29')!;
    expect(tue.activities.map(a => a.id)).toEqual(['long', 'short']);
    expect(r.days.find(d => d.date === '2026-09-28')!.activities).toEqual([]);
    expect(r.days.find(d => d.date === '2026-09-30')!.activities).toEqual([]);
  });

  it('is a link on the week strip and on the seven-day bars, for everyone', () => {
    // The week card (2026-10-17): a day opens a sheet that lists the day's runs.
    const week = readFileSync('src/components/profile/WeekPlanCard.tsx', 'utf8');
    expect(week).toMatch(/athleteId \? `\/api\/athletes\/\$\{athleteId\}\/stats` : null/);
    expect(week).toMatch(/href=\{`\/dashboard\/activities\/\$\{a\.id\}`\}/);
    const card = readFileSync('src/components/profile/Last7DaysCard.tsx', 'utf8');
    expect(card).toMatch(/const run = opensRuns \? d\.activities\?\.\[0\] : undefined;/);
    // Rolled out: no super-user gate left on either.
    expect(card).toMatch(/const opensRuns = true;/);
    // The profile body asks for the same key, so the strip costs no request.
    expect(readFileSync('src/components/profile/AthleteProfileBody.tsx', 'utf8')).toMatch(/athleteId \? `\/api\/athletes\/\$\{athleteId\}\/stats` : null/);
  });
});
