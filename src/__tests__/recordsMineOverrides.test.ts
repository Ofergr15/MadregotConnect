import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withOverride, bestOf } from '@/lib/records/mine-overrides';

// "בגרפי השיאים לא מופיעים השיאים האישיים שלי": a stated time was in the PR table but never on the curve.
describe('records/progress: the caller\'s own stated times', () => {
  const runs = [{ date: '2026-03-01', seconds: 1400 }, { date: '2026-07-01', seconds: 1350 }];

  it('no override: the run breaks as before', () => {
    expect(withOverride(runs, undefined, '2026-11-25')).toBe(runs);
  });
  it('a stated time with no runs at all is a break (the empty-chart case)', () => {
    const b = withOverride([], { bucketKey: '5k', seconds: 1290, achievedOn: '2026-05-10', hidden: false }, '2026-11-25');
    expect(b).toEqual([{ date: '2026-05-10', seconds: 1290 }]);
    expect(bestOf(b)).toEqual({ date: '2026-05-10', seconds: 1290 });
  });
  it('replaces the best like the table does: faster run breaks (a glitch) are dropped', () => {
    const b = withOverride([...runs, { date: '2026-08-01', seconds: 1100 }], { bucketKey: '5k', seconds: 1320, achievedOn: '2026-09-01', hidden: false }, '2026-11-25');
    expect(b.map((x) => x.seconds)).toEqual([1400, 1350, 1320]);
    expect(bestOf(b)?.seconds).toBe(1320);
  });
  it('no date → today; hidden → no PR for that distance', () => {
    expect(withOverride([], { bucketKey: 'hm', seconds: 5400, achievedOn: null, hidden: false }, '2026-11-25')[0].date).toBe('2026-11-25');
    expect(withOverride(runs, { bucketKey: '5k', seconds: 1290, achievedOn: null, hidden: true }, '2026-11-25')).toEqual([]);
  });
  it('the route uses it for both the curve and `mine`, from the caller\'s own rows only', () => {
    const src = readFileSync('src/app/api/records/progress/route.ts', 'utf8');
    expect(src).toMatch(/withOverride\(breaks\[distance\]\?\.\[caller\.athleteId\]/);
    expect(src).toMatch(/withOverride\(breaks\[b\.key\]\?\.\[caller\.athleteId!\]/);
    expect(src).toMatch(/from\('athlete_pr_overrides'\)[\s\S]{0,120}\.eq\('athlete_id', caller\.athleteId\)/);
  });
});
