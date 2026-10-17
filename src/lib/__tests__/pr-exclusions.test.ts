import { describe, expect, it } from 'vitest';
import { computeDistanceBests, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { computeRecordHistory, recordBreaks, yearBests } from '@/lib/prs/record-history';
import { excludedRunsByBucket, isExcluded } from '@/lib/prs/exclusions-store';

const run = (id: string, date: string, seconds: number): RunActivityRow =>
  ({ id, activity_name: id, activity_type: 'running', start_time: `${date}T06:00:00Z`, distance: 5000, duration: seconds });
// 13.9 is the run the athlete knows is wrong (the 2026-10-17 report).
const runs = [run('a', '2022-07-05', 1130), run('b', '2026-03-27', 1117), run('glitch', '2026-09-13', 886), run('c', '2026-09-23', 1092)];

describe('runs taken out of the records (migration 146)', () => {
  it('the next real best takes the place of a run taken out', () => {
    const excluded = new Map([['glitch', new Set(['5k'])]]);
    expect(computeDistanceBests(runs).find(b => b.key === '5k')?.activityId).toBe('glitch');
    expect(computeDistanceBests(runs, { excluded }).find(b => b.key === '5k')).toMatchObject({ activityId: 'c', seconds: 1092 });
  });

  it('the history reads as if it had never been run — 18:12 is a break again', () => {
    const excluded = new Map([['glitch', new Set(['*'])]]);
    expect(recordBreaks(runs, '5k').map(b => b.activityId)).toEqual(['a', 'b', 'glitch']);
    expect(recordBreaks(runs, '5k', excluded).map(b => b.activityId)).toEqual(['a', 'b', 'c']);
    expect(computeRecordHistory(runs, excluded)['5k'].at(-1)?.activityId).toBe('c');
  });

  it("and it can't come back as this year's best either", () => {
    expect(yearBests(runs, '2026')['5k']).toBe(886);
    expect(yearBests(runs, '2026', new Map([['glitch', new Set(['5k'])]]))['5k']).toBe(1092);
  });

  it('taking it out of one distance leaves the others', () => {
    const ex = new Map([['glitch', new Set(['5k'])], ['other', new Set(['*'])]]);
    expect(isExcluded(ex, 'glitch', '5k')).toBe(true);
    expect(isExcluded(ex, 'glitch', '10k')).toBe(false);
    expect(isExcluded(ex, 'other', 'fm')).toBe(true);
    expect(isExcluded(undefined, 'glitch', '5k')).toBe(false);
  });

  it('lists what was taken out of each distance, for the record screen to put back', () => {
    const ex = new Map([['glitch', new Set(['5k'])], ['c', new Set(['*'])]]);
    const out = excludedRunsByBucket(runs, ex);
    expect(out['5k'].map(r => r.activityId).sort()).toEqual(['c', 'glitch']);
    expect(out['10k'].map(r => r.activityId)).toEqual(['c']);
  });
});
