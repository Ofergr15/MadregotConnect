import { describe, it, expect } from 'vitest';
import { applyPrOverrides, parsePrSeconds, prSecondsProblem, type PrOverride } from '@/lib/prs/overrides';
import { PR_BUCKETS, type DistanceBest } from '@/lib/prs/pr-buckets';

/**
 * Athlete-stated personal records.
 *
 * The three things worth pinning down are the three that would be silent
 * failures on someone's profile: a stated time that gets quietly ignored because
 * the derived one was faster, a stated time that keeps the derived run's link and
 * so claims a provenance it doesn't have, and a typo (`20:06:00` for `20:06`)
 * that gets stored as a record nobody ran.
 */

const derived = (key: string, seconds: number | null): DistanceBest => {
  const bucket = PR_BUCKETS.find((b) => b.key === key)!;
  return {
    key: bucket.key,
    label: bucket.label,
    meters: bucket.meters,
    seconds,
    date: seconds == null ? null : '2026-05-01T06:00:00+03:00',
    activityName: seconds == null ? null : 'Morning Run',
    activityId: seconds == null ? null : 'act-1',
    fromSegment: seconds != null,
    sourceMeters: seconds == null ? null : bucket.meters + 40,
  };
};

const override = (partial: Partial<PrOverride> & { bucketKey: string }): PrOverride => ({
  seconds: null,
  achievedOn: null,
  note: null,
  hidden: false,
  ...partial,
});

describe('applyPrOverrides', () => {
  it('leaves a bucket with no override alone, marked as derived', () => {
    const [best] = applyPrOverrides([derived('5k', 1230)], []);
    expect(best).toMatchObject({ seconds: 1230, activityId: 'act-1', source: 'auto', note: null });
  });

  /**
   * The whole point of the feature: the athlete is correcting a number, so the
   * number they state wins even when it is SLOWER than what the watch derived.
   * A `min()` merge would hand them back the bogus PR they came to fix.
   */
  it('replaces a faster derived best with a slower stated one', () => {
    const [best] = applyPrOverrides(
      [derived('5k', 1170)],
      [override({ bucketKey: '5k', seconds: 1264, achievedOn: '2026-03-14' })],
    );
    expect(best.seconds).toBe(1264);
    expect(best.date).toBe('2026-03-14');
    expect(best.source).toBe('manual');
  });

  /** A hand-typed race time did not happen "inside a 31 km run". */
  it('drops the derived run link and segment provenance from a stated time', () => {
    const [best] = applyPrOverrides([derived('10k', 2600)], [override({ bucketKey: '10k', seconds: 2518 })]);
    expect(best.activityId).toBeNull();
    expect(best.activityName).toBeNull();
    expect(best.sourceMeters).toBeNull();
    expect(best.fromSegment).toBe(false);
  });

  it('carries the athlete note through so the tile can say where it came from', () => {
    const [best] = applyPrOverrides(
      [derived('hm', null)],
      [override({ bucketKey: 'hm', seconds: 5678, note: 'חצי מרתון תל אביב' })],
    );
    expect(best.note).toBe('חצי מרתון תל אביב');
  });

  /** Hidden reads as an empty bucket — no caller learns a third state. */
  it('empties a hidden bucket the way a bucket with no PR looks', () => {
    const [best] = applyPrOverrides([derived('fm', 12000)], [override({ bucketKey: 'fm', hidden: true })]);
    expect(best.seconds).toBeNull();
    expect(best.date).toBeNull();
    expect(best.activityId).toBeNull();
    expect(best.source).toBe('manual');
  });

  it('ignores an override for a bucket this build does not have', () => {
    const merged = applyPrOverrides([derived('5k', 1230)], [override({ bucketKey: '3k', seconds: 600 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].seconds).toBe(1230);
  });

  it('touches only the bucket it names', () => {
    const merged = applyPrOverrides(
      [derived('5k', 1230), derived('10k', 2600)],
      [override({ bucketKey: '10k', seconds: 2518 })],
    );
    expect(merged.map((m) => m.source)).toEqual(['auto', 'manual']);
    expect(merged[0].activityId).toBe('act-1');
  });
});

describe('parsePrSeconds', () => {
  it('reads the two shapes a runner types', () => {
    expect(parsePrSeconds('41:58')).toBe(2518);
    expect(parsePrSeconds('3:12:40')).toBe(11560);
    expect(parsePrSeconds(' 20:06 ')).toBe(1206);
  });

  /** A chip time is often published as `41:58.4`; the fraction is dropped, not rounded up. */
  it('drops a chip time fraction', () => {
    expect(parsePrSeconds('41:58.4')).toBe(2518);
  });

  it('refuses anything that is not a time', () => {
    for (const input of ['', '41', 'abc', '41:', ':58', '41:58:12:03', '41.58', '1:2:3:4']) {
      expect(parsePrSeconds(input), input).toBeNull();
    }
  });

  /** `1:75:00` is a typo, not 2:15:00 — guessing at intent here invents a record. */
  it('refuses a non-leading field above 59', () => {
    expect(parsePrSeconds('1:75:00')).toBeNull();
    expect(parsePrSeconds('41:75')).toBeNull();
    expect(parsePrSeconds('75:00')).toBe(4500); // leading field may run over
  });
});

describe('prSecondsProblem', () => {
  it('accepts real times at every bucket', () => {
    expect(prSecondsProblem('5k', 1170)).toBeNull();      // 19:30
    expect(prSecondsProblem('10k', 2518)).toBeNull();     // 41:58
    expect(prSecondsProblem('hm', 5940)).toBeNull();      // 1:39:00
    expect(prSecondsProblem('fm', 12780)).toBeNull();     // 3:33:00
  });

  /** The factor-of-60 slip in both directions — the mistake a phone keypad makes. */
  it('catches a minutes/seconds slip', () => {
    expect(prSecondsProblem('5k', 1206 * 60)).toBe('too-slow');
    expect(prSecondsProblem('fm', 12780 / 60)).toBe('too-fast');
  });

  it('accepts a walked marathon and refuses an impossible one', () => {
    expect(prSecondsProblem('fm', 8 * 3600)).toBeNull();
    expect(prSecondsProblem('fm', 60 * 60)).toBe('too-fast');
  });

  it('reports an unknown bucket rather than guessing bounds for it', () => {
    expect(prSecondsProblem('3k', 600)).toBe('unknown-bucket');
  });

  it('refuses a non-integer or non-finite value', () => {
    expect(prSecondsProblem('5k', 1230.5)).toBe('too-fast');
    expect(prSecondsProblem('5k', Number.NaN)).toBe('too-fast');
  });
});
