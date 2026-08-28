import { describe, expect, it } from 'vitest';
import { buildClubFollowRows, buildFollowRowsForAthlete } from '@/lib/follows/club-sync';

const key = (r: { follower_id: string; followee_id: string }) => `${r.follower_id}->${r.followee_id}`;

describe('buildClubFollowRows', () => {
  it('produces every ordered pair and nothing else', () => {
    const rows = buildClubFollowRows(['a', 'b', 'c']);
    expect(rows).toHaveLength(6); // n*(n-1)
    expect(new Set(rows.map(key))).toEqual(
      new Set(['a->b', 'a->c', 'b->a', 'b->c', 'c->a', 'c->b']),
    );
  });

  it('never has anyone follow themselves', () => {
    const rows = buildClubFollowRows(['a', 'b', 'c', 'd']);
    expect(rows.some((r) => r.follower_id === r.followee_id)).toBe(false);
  });

  it('is symmetric — every follow has a matching reverse', () => {
    const rows = buildClubFollowRows(['a', 'b', 'c', 'd']);
    const seen = new Set(rows.map(key));
    for (const r of rows) expect(seen.has(`${r.followee_id}->${r.follower_id}`)).toBe(true);
  });

  it('degrades to nothing below two athletes', () => {
    expect(buildClubFollowRows(['a'])).toEqual([]);
    expect(buildClubFollowRows([])).toEqual([]);
  });

  it('tolerates a duplicated id without emitting a self-follow', () => {
    const rows = buildClubFollowRows(['a', 'b', 'a']);
    expect(new Set(rows.map(key))).toEqual(new Set(['a->b', 'b->a']));
  });

  // The club is ~20 people; this is the number the reconcile actually upserts.
  it('scales as n*(n-1)', () => {
    expect(buildClubFollowRows(Array.from({ length: 20 }, (_, i) => `a${i}`))).toHaveLength(380);
  });
});

describe('buildFollowRowsForAthlete', () => {
  it('follows both directions with everyone else', () => {
    const rows = buildFollowRowsForAthlete('me', ['me', 'a', 'b']);
    expect(new Set(rows.map(key))).toEqual(new Set(['me->a', 'a->me', 'me->b', 'b->me']));
  });

  it('excludes the athlete even when the club list omits them', () => {
    const rows = buildFollowRowsForAthlete('me', ['a']);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.follower_id === r.followee_id)).toBe(false);
  });

  it('returns nothing for a club of one', () => {
    expect(buildFollowRowsForAthlete('me', ['me'])).toEqual([]);
    expect(buildFollowRowsForAthlete('me', [])).toEqual([]);
  });
});
