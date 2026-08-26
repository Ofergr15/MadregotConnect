import { describe, expect, it } from 'vitest';
import { computeMutedAthleteIds, computeMaintenanceAllowedIds, matchesAudience } from '@/lib/push';

describe('computeMutedAthleteIds', () => {
  it('an athlete with no notification_prefs object at all is NOT muted (default opted-in)', () => {
    const muted = computeMutedAthleteIds([{ id: 'a1' }], 'news');
    expect(muted.has('a1')).toBe(false);
  });

  it('an athlete whose prefs object exists but omits this category is NOT muted', () => {
    const muted = computeMutedAthleteIds([{ id: 'a1', notification_prefs: { coach: false } }], 'news');
    expect(muted.has('a1')).toBe(false);
  });

  it('only an explicit false for this exact category mutes the athlete', () => {
    const muted = computeMutedAthleteIds([{ id: 'a1', notification_prefs: { news: false } }], 'news');
    expect(muted.has('a1')).toBe(true);
  });

  it('mutes are per-category — muting one category never mutes another for the same athlete', () => {
    const muted = computeMutedAthleteIds([{ id: 'a1', notification_prefs: { news: false, coach: true } }], 'coach');
    expect(muted.has('a1')).toBe(false);
  });

  it('correctly separates muted and unmuted athletes across a mixed set', () => {
    const muted = computeMutedAthleteIds([
      { id: 'a1', notification_prefs: { news: false } },
      { id: 'a2', notification_prefs: { news: true } },
      { id: 'a3' },
    ], 'news');
    expect([...muted]).toEqual(['a1']);
  });

  it('an explicit `true` (not just absence) is treated the same as opted-in', () => {
    const muted = computeMutedAthleteIds([{ id: 'a1', notification_prefs: { news: true } }], 'news');
    expect(muted.has('a1')).toBe(false);
  });
});

describe('computeMaintenanceAllowedIds', () => {
  it('matches by email case-insensitively', () => {
    const allowed = computeMaintenanceAllowedIds(
      new Set(['alice@example.com']),
      [{ id: 'a1', email: 'Alice@Example.com' }],
    );
    expect(allowed.has('a1')).toBe(true);
  });

  it('excludes athletes whose email is not on the allowlist', () => {
    const allowed = computeMaintenanceAllowedIds(
      new Set(['alice@example.com']),
      [{ id: 'a1', email: 'bob@example.com' }],
    );
    expect(allowed.has('a1')).toBe(false);
  });

  it('an athlete with a null email is not allowed against a real (non-empty) allowlist', () => {
    const allowed = computeMaintenanceAllowedIds(new Set(['alice@example.com']), [{ id: 'a1', email: null }]);
    expect(allowed.has('a1')).toBe(false);
  });

  it('an empty allowlist allows nobody', () => {
    const allowed = computeMaintenanceAllowedIds(new Set(), [{ id: 'a1', email: 'alice@example.com' }]);
    expect(allowed.size).toBe(0);
  });
});

describe('matchesAudience', () => {
  const athlete = { group_id: 'group-a' };
  const since = '2026-01-01T00:00:00.000Z';
  const after = '2026-01-02T00:00:00.000Z';
  const before = '2025-12-31T00:00:00.000Z';

  it('a broadcast to "all" matches any athlete, sent after `since`', () => {
    expect(matchesAudience({ audience_type: 'all', audience_id: null, last_sent_at: after }, athlete, 'a1', since)).toBe(true);
  });

  it('a group notification matches only an athlete in that exact group', () => {
    expect(matchesAudience({ audience_type: 'group', audience_id: 'group-a', last_sent_at: after }, athlete, 'a1', since)).toBe(true);
    expect(matchesAudience({ audience_type: 'group', audience_id: 'group-b', last_sent_at: after }, athlete, 'a1', since)).toBe(false);
  });

  it('an athlete with no group_id never matches a real group-targeted notification', () => {
    expect(matchesAudience({ audience_type: 'group', audience_id: 'group-a', last_sent_at: after }, { group_id: null }, 'a1', since)).toBe(false);
  });

  it('a direct athlete notification matches only that exact athlete id', () => {
    expect(matchesAudience({ audience_type: 'athlete', audience_id: 'a1', last_sent_at: after }, athlete, 'a1', since)).toBe(true);
    expect(matchesAudience({ audience_type: 'athlete', audience_id: 'a2', last_sent_at: after }, athlete, 'a1', since)).toBe(false);
  });

  it('never counts a notification sent at or before `since`, regardless of audience match', () => {
    expect(matchesAudience({ audience_type: 'all', audience_id: null, last_sent_at: since }, athlete, 'a1', since)).toBe(false);
    expect(matchesAudience({ audience_type: 'all', audience_id: null, last_sent_at: before }, athlete, 'a1', since)).toBe(false);
  });

  it('an unrecognized audience_type never matches', () => {
    expect(matchesAudience({ audience_type: 'weird', audience_id: 'a1', last_sent_at: after }, athlete, 'a1', since)).toBe(false);
  });
});
