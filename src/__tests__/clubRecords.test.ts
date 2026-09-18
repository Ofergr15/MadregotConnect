import { describe, it, expect } from 'vitest';
import { computeClubRecords, clubRankFor, type ClubRecordAthlete } from '@/lib/prs/club-records';
import type { RunActivityRow } from '@/lib/prs/pr-buckets';
import type { PrOverride } from '@/lib/prs/overrides';
import { isStale, refreshAllowed, TTL_MS, REFRESH_FLOOR_MS, type ClubRecordsSnapshot } from '@/lib/prs/club-records-store';

/**
 * The club records board.
 *
 * What is worth pinning down is what would be a silent wrong answer on a shared
 * screen: a ranking that disagrees with the profile it links to (an athlete's
 * stated time ignored), a hidden record still on the board, a non-run counted, and
 * a tie resolved by roster order — which would reshuffle when somebody joins.
 */

const athlete = (id: string, name: string): ClubRecordAthlete => ({ id, name, groupId: null, gender: null });

/** A whole-activity run in a bucket's tolerance window. */
const run = (distance: number, duration: number, start = '2026-04-01T06:00:00+03:00'): RunActivityRow => ({
  id: `${distance}-${duration}-${start}`,
  activity_name: 'Morning Run',
  activity_type: 'running',
  start_time: start,
  distance,
  duration,
});

const override = (partial: Partial<PrOverride> & { bucketKey: string }): PrOverride => ({
  seconds: null,
  achievedOn: null,
  note: null,
  hidden: false,
  ...partial,
});

const bucketOf = (buckets: ReturnType<typeof computeClubRecords>, key: string) =>
  buckets.find((b) => b.key === key)!;

describe('computeClubRecords', () => {
  it('ranks a bucket fastest first and names each athlete', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana'), athlete('b', 'Noam'), athlete('c', 'Yael')],
      runsByAthlete: new Map([
        ['a', [run(5000, 1300)]],
        ['b', [run(5000, 1180)]],
        ['c', [run(5000, 1240)]],
      ]),
      overridesByAthlete: new Map(),
    });
    const fiveK = bucketOf(buckets, '5k');
    expect(fiveK.entries.map((e) => [e.name, e.seconds])).toEqual([
      ['Noam', 1180],
      ['Yael', 1240],
      ['Dana', 1300],
    ]);
  });

  it('returns a row for every bucket even when nobody has run it', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana')],
      runsByAthlete: new Map([['a', [run(5000, 1300)]]]),
      overridesByAthlete: new Map(),
    });
    expect(buckets.map((b) => b.key)).toEqual(['5k', '10k', 'hm', 'fm']);
    expect(bucketOf(buckets, 'fm').entries).toEqual([]);
  });

  /**
   * The board and the profile must show the same number. A derived-only board
   * would rank an athlete by the bogus time they came to the app to correct.
   */
  it('uses an athlete-stated time even when it is slower than the derived one', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana'), athlete('b', 'Noam')],
      runsByAthlete: new Map([
        ['a', [run(5000, 1170)]],
        ['b', [run(5000, 1240)]],
      ]),
      overridesByAthlete: new Map([['a', [override({ bucketKey: '5k', seconds: 1264, achievedOn: '2026-03-14' })]]]),
    });
    const fiveK = bucketOf(buckets, '5k');
    expect(fiveK.entries.map((e) => [e.name, e.seconds])).toEqual([
      ['Noam', 1240],
      ['Dana', 1264],
    ]);
    expect(fiveK.entries[1]).toMatchObject({ source: 'manual', activityId: null, date: '2026-03-14' });
  });

  it('keeps a hidden record off the board entirely', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana'), athlete('b', 'Noam')],
      runsByAthlete: new Map([
        ['a', [run(5000, 1100)]],
        ['b', [run(5000, 1240)]],
      ]),
      overridesByAthlete: new Map([['a', [override({ bucketKey: '5k', hidden: true })]]]),
    });
    expect(bucketOf(buckets, '5k').entries.map((e) => e.name)).toEqual(['Noam']);
  });

  /** A stated time is the only record some athletes have — a race before the club. */
  it('boards an athlete with no runs at all but a stated time', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana')],
      runsByAthlete: new Map(),
      overridesByAthlete: new Map([['a', [override({ bucketKey: 'fm', seconds: 12780, note: 'מרתון תל אביב' })]]]),
    });
    expect(bucketOf(buckets, 'fm').entries).toHaveLength(1);
    expect(bucketOf(buckets, 'fm').entries[0]).toMatchObject({ seconds: 12780, note: 'מרתון תל אביב' });
  });

  it('excludes a walk, the same way the profile does', () => {
    const walk = { ...run(5000, 2400), activity_type: 'walking' };
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana')],
      runsByAthlete: new Map([['a', [walk]]]),
      overridesByAthlete: new Map(),
    });
    expect(bucketOf(buckets, '5k').entries).toEqual([]);
  });

  /** Ties go to whoever got there first, not to whoever the roster query listed first. */
  it('breaks an exact tie on the earlier date', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana'), athlete('b', 'Noam')],
      runsByAthlete: new Map([
        ['a', [run(5000, 1200, '2026-05-01T06:00:00+03:00')]],
        ['b', [run(5000, 1200, '2024-05-01T06:00:00+03:00')]],
      ]),
      overridesByAthlete: new Map(),
    });
    expect(bucketOf(buckets, '5k').entries.map((e) => e.name)).toEqual(['Noam', 'Dana']);
  });

  it('takes each athlete only once per bucket, at their own best', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana')],
      runsByAthlete: new Map([['a', [run(5000, 1300), run(5000, 1210), run(5100, 1400)]]]),
      overridesByAthlete: new Map(),
    });
    expect(bucketOf(buckets, '5k').entries).toHaveLength(1);
    expect(bucketOf(buckets, '5k').entries[0].seconds).toBe(1210);
  });
});

describe('clubRankFor', () => {
  it('gives a 1-based place per bucket and skips the ones with no time', () => {
    const buckets = computeClubRecords({
      athletes: [athlete('a', 'Dana'), athlete('b', 'Noam')],
      runsByAthlete: new Map([
        ['a', [run(5000, 1300), run(10000, 2600)]],
        ['b', [run(5000, 1180)]],
      ]),
      overridesByAthlete: new Map(),
    });
    expect(clubRankFor(buckets, 'a')).toEqual({ '5k': { rank: 2, of: 2 }, '10k': { rank: 1, of: 1 } });
    expect(clubRankFor(buckets, 'b')).toEqual({ '5k': { rank: 1, of: 2 } });
    expect(clubRankFor(buckets, 'nobody')).toEqual({});
  });
});

describe('snapshot freshness', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');
  const snap = (computedAt: string): ClubRecordsSnapshot => ({ computedAt, buckets: [], athleteCount: 24 });

  it('treats a missing or unparseable snapshot as stale', () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(snap('not a date'), now)).toBe(true);
  });

  it('recomputes only past the TTL', () => {
    expect(isStale(snap(new Date(now - TTL_MS + 1000).toISOString()), now)).toBe(false);
    expect(isStale(snap(new Date(now - TTL_MS - 1000).toISOString()), now)).toBe(true);
  });

  /** The floor is what keeps a reload button from becoming a load test. */
  it('refuses a refresh under the floor and allows it above', () => {
    expect(refreshAllowed(snap(new Date(now - REFRESH_FLOOR_MS + 1000).toISOString()), now)).toBe(false);
    expect(refreshAllowed(snap(new Date(now - REFRESH_FLOOR_MS - 1000).toISOString()), now)).toBe(true);
    expect(refreshAllowed(null, now)).toBe(true);
  });
});
