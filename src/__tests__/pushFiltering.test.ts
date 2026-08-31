import { describe, expect, it } from 'vitest';
import { computeMutedAthleteIds, computeMaintenanceAllowedIds, matchesAudience, countsTowardBadge } from '@/lib/push';

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

describe('countsTowardBadge', () => {
  // The app-icon badge and the inbox list are two views of the same rows, and
  // every way they disagreed made the badge read too high. Each case below is
  // one of those disagreements.
  const athlete = { group_id: 'g1' };
  const SINCE = '2026-08-01T00:00:00Z';
  const row = (over: Partial<{ kind: string; url: string | null; audience_type: string; audience_id: string | null; last_sent_at: string }> = {}) => ({
    kind: 'kudos_activity',
    url: '/dashboard/feed?activity=1',
    audience_type: 'athlete',
    audience_id: 'a1',
    last_sent_at: '2026-08-02T00:00:00Z',
    ...over,
  });

  it('counts an ordinary notification targeting the athlete', () => {
    expect(countsTowardBadge(row(), athlete, 'a1', SINCE)).toBe(true);
  });

  it('never counts a #ledger: idempotency row, however well it matches', () => {
    // 77 of these existed in production, hidden from the inbox but counted by
    // the badge — unread notifications the athlete could not open or clear.
    expect(countsTowardBadge(row({ url: '#ledger:postWorkoutPrompt:a1:2026-08-02' }), athlete, 'a1', SINCE)).toBe(false);
  });

  it('never counts a ledger row broadcast to everyone', () => {
    // The worst shape: cron/tick writes its training_before sentinel with
    // audience_type 'all', so one row inflated EVERY athlete's badge.
    const led = row({ kind: 'training_before', url: '#ledger:trainingBefore:2026-08-02', audience_type: 'all', audience_id: null });
    expect(countsTowardBadge(led, athlete, 'a1', SINCE)).toBe(false);
    expect(countsTowardBadge(led, { group_id: null }, 'someone-else', SINCE)).toBe(false);
  });

  it('does not count a notification whose category the athlete muted', () => {
    expect(countsTowardBadge(row(), athlete, 'a1', SINCE, { teammates: false })).toBe(false);
  });

  it('still counts it when a DIFFERENT category is muted', () => {
    expect(countsTowardBadge(row(), athlete, 'a1', SINCE, { news: false, workouts: false })).toBe(true);
  });

  it('applies the audience rule as before — a muted-category check never overrides it', () => {
    expect(countsTowardBadge(row({ audience_id: 'other' }), athlete, 'a1', SINCE)).toBe(false);
    expect(countsTowardBadge(row({ last_sent_at: SINCE }), athlete, 'a1', SINCE)).toBe(false);
  });

  it('counts a kind with no category mapping even when prefs exist', () => {
    // `approval` and `store_order` send their push without a category, so no
    // toggle mutes them; the badge has to agree, or it under-counts instead.
    expect(countsTowardBadge(row({ kind: 'approval' }), athlete, 'a1', SINCE, { teammates: false, news: false })).toBe(true);
    expect(countsTowardBadge(row({ kind: 'store_order' }), athlete, 'a1', SINCE, { news: false })).toBe(true);
  });

  it('counts a group broadcast for a member, and mutes it by category all the same', () => {
    const g = row({ kind: 'custom', audience_type: 'group', audience_id: 'g1' });
    expect(countsTowardBadge(g, athlete, 'a1', SINCE)).toBe(true);
    expect(countsTowardBadge(g, athlete, 'a1', SINCE, { news: false })).toBe(false);
  });

  it('treats a missing url as an ordinary row, not a ledger row', () => {
    expect(countsTowardBadge(row({ url: null }), athlete, 'a1', SINCE)).toBe(true);
  });
});
