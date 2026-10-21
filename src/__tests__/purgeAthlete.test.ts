import { describe, expect, it } from 'vitest';
import { SUBJECT_COLUMNS } from '@/lib/admin/purge-athlete';

describe('full delete: what counts as "about the person"', () => {
  it('never deletes rows that only NAME them as somebody else (a coach on a trainee\'s test)', () => {
    expect(SUBJECT_COLUMNS.some(([, c]) => c === 'author_id')).toBe(false);
  });
  it('covers their runs, their posts, their login plumbing and both sides of a follow', () => {
    const has = (t: string, c: string) => SUBJECT_COLUMNS.some(([a, b]) => a === t && b === c);
    expect(has('athlete_activities', 'athlete_id')).toBe(true);
    expect(has('feed_items', 'author_athlete_id')).toBe(true);
    expect(has('push_subscriptions', 'athlete_id')).toBe(true);
    expect(has('athlete_follows', 'follower_id') && has('athlete_follows', 'followee_id')).toBe(true);
  });
});
