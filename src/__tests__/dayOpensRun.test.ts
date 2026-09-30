import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { buildLast7Report } from '@/lib/reports/last-7-days';

/**
 * TAP A DAY, GET THE RUN (feedback #94), for the super user until rollout.
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

  it('is a link on the week strip and on the seven-day bars, for the super user only', () => {
    const overview = readFileSync('src/components/profile/ProfileOverview.tsx', 'utf8');
    expect(overview).toMatch(/opensRuns && athleteId \? `\/api\/athletes\/\$\{athleteId\}\/stats` : null/);
    expect(overview).toMatch(/<Link href=\{`\/dashboard\/activities\/\$\{run\.id\}`\} aria-label=\{openLabel\}/);
    const card = readFileSync('src/components/profile/Last7DaysCard.tsx', 'utf8');
    expect(card).toMatch(/const run = opensRuns \? d\.activities\?\.\[0\] : undefined;/);
    // The profile body asks for the same key, so the strip costs no request.
    expect(readFileSync('src/components/profile/AthleteProfileBody.tsx', 'utf8')).toMatch(/athleteId \? `\/api\/athletes\/\$\{athleteId\}\/stats` : null/);
  });
});
