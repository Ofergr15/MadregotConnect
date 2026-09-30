import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { prRunsByActivity } from '@/lib/prs/pr-runs';

/**
 * A RECORD GETS A BADGE ON ITS RUN (feedback #90), for the super user until rollout.
 */
describe('the runs that hold a record', () => {
  it('names every distance a run is the record for, and nothing for a stated time', () => {
    const got = prRunsByActivity([
      { key: '5k', entries: [{ athleteId: 'a', activityId: 'r1' }, { athleteId: 'b', activityId: null }] },
      { key: '10k', entries: [{ athleteId: 'a', activityId: 'r1' }, { athleteId: 'b', activityId: 'r2' }] },
      { key: 'hm', entries: [] },
    ]);
    expect(got.get('r1')).toEqual(['5k', '10k']);
    expect(got.get('r2')).toEqual(['10k']);
    expect(got.size).toBe(2);
    expect(prRunsByActivity(undefined).size).toBe(0);
  });

  it('is asked for only by the super user, and shown on the feed card and the run page', () => {
    const badge = readFileSync('src/components/PrBadge.tsx', 'utf8');
    expect(badge).toMatch(/useApi<\{ buckets\?: RecordBucketLike\[\] \}>\(superUser \? '\/api\/club\/records' : null\)/);
    expect(readFileSync('src/components/FeedCard.tsx', 'utf8')).toMatch(/const prBuckets = usePrRuns\(\)\.get\(act\.id\);/);
    expect(readFileSync('src/app/(app)/dashboard/activities/[activityId]/page.tsx', 'utf8')).toMatch(/<PrBadge buckets=\{prRuns\.get\(act\.id\)\} \/>/);
  });
});
