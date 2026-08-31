import { describe, expect, it } from 'vitest';
import { isMigrationMissing, mergeWithDefaults, DEFAULTS, CATEGORIES, KIND_CATEGORY, isKindMuted, isLedgerRow } from '@/lib/notifications/prefs';

describe('isMigrationMissing', () => {
  it('is false for null (no error)', () => {
    expect(isMigrationMissing(null)).toBe(false);
  });

  it('is false for an unrelated error — must NOT catch every DB error', () => {
    // This exact over-broad catch (any error -> defaults) was a real,
    // shipped bug: a transient DB hiccup on GET silently showed all-defaults,
    // which looked indistinguishable from a saved "off" preference randomly
    // flipping back to "on" on its own.
    expect(isMigrationMissing({ message: 'connection timeout', code: '57014' })).toBe(false);
    expect(isMigrationMissing({ message: 'permission denied for table athletes', code: '42501' })).toBe(false);
  });

  it('is true when the error message mentions notification_prefs', () => {
    expect(isMigrationMissing({ message: 'column "notification_prefs" does not exist' })).toBe(true);
  });

  it('is true for Postgres undefined-column code 42703 regardless of message', () => {
    expect(isMigrationMissing({ message: 'something else entirely', code: '42703' })).toBe(true);
  });

  it('handles a missing message string without throwing', () => {
    expect(isMigrationMissing({ code: '42703' })).toBe(true);
    expect(isMigrationMissing({})).toBe(false);
  });
});

describe('mergeWithDefaults', () => {
  it('returns all-on defaults when saved is null/undefined', () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULTS);
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULTS);
  });

  it('returns all-on defaults for an empty saved object', () => {
    expect(mergeWithDefaults({})).toEqual(DEFAULTS);
  });

  it('an explicit false for one category overrides its default without affecting the others', () => {
    const result = mergeWithDefaults({ news: false });
    expect(result.news).toBe(false);
    for (const cat of CATEGORIES) {
      if (cat !== 'news') expect(result[cat]).toBe(true);
    }
  });

  it('multiple explicit overrides all apply independently', () => {
    const result = mergeWithDefaults({ news: false, coach: false });
    expect(result).toEqual({ ...DEFAULTS, news: false, coach: false });
  });

  it('an explicit true for a category is preserved (not just a no-op)', () => {
    // Guards against a merge implementation that treats truthy-default +
    // truthy-override as "nothing to do" and accidentally drops the key.
    const result = mergeWithDefaults({ news: true });
    expect(result.news).toBe(true);
    expect(Object.keys(result)).toEqual(Object.keys(DEFAULTS));
  });
});

describe('KIND_CATEGORY', () => {
  it('every mapped category is a real preference category', () => {
    // A typo here would silently make a kind unmutable rather than fail loudly,
    // since isKindMuted only ever reads prefs[category].
    for (const [kind, category] of Object.entries(KIND_CATEGORY)) {
      expect(CATEGORIES, `${kind} → ${category}`).toContain(category);
    }
  });

  it('covers every kind that exists in production', () => {
    // Snapshot of `SELECT DISTINCT kind FROM scheduled_notifications` taken
    // 2026-08-31 (875 rows), minus the two deliberate omissions below. A kind
    // added later without a mapping stays in the badge — this test is what says
    // whether that was a decision or an oversight.
    const inProduction = [
      'kudos_activity', 'badge', 'training_before', 'activity_sync_editor',
      'workout_detected', 'like', 'post_workout_prompt', 'custom', 'comment',
      'survey', 'follow', 'kudos',
    ];
    for (const kind of inProduction) {
      expect(KIND_CATEGORY[kind], `unmapped kind: ${kind}`).toBeDefined();
    }
  });

  it('deliberately does NOT map the kinds whose push ignores preferences', () => {
    // Badge and push have to agree: these two send with no `category`, so no
    // toggle silences them and the badge must keep counting them.
    expect(KIND_CATEGORY['approval']).toBeUndefined();
    expect(KIND_CATEGORY['store_order']).toBeUndefined();
  });

  it('the ledger bookkeeping kind is not mapped — it is excluded by url, not category', () => {
    expect(KIND_CATEGORY['post_workout_prompt_ledger']).toBeUndefined();
  });
});

describe('isKindMuted', () => {
  it('is false when the athlete has no saved prefs at all', () => {
    expect(isKindMuted('kudos_activity', null)).toBe(false);
    expect(isKindMuted('kudos_activity', undefined)).toBe(false);
    expect(isKindMuted('kudos_activity', {})).toBe(false);
  });

  it('mutes a kind whose category is explicitly off', () => {
    expect(isKindMuted('kudos_activity', { teammates: false })).toBe(true);
    expect(isKindMuted('badge', { achievements: false })).toBe(true);
  });

  it('an explicit true is not muted', () => {
    expect(isKindMuted('kudos_activity', { teammates: true })).toBe(false);
  });

  it('muting one category never mutes a kind from another', () => {
    expect(isKindMuted('kudos_activity', { workouts: false, news: false })).toBe(false);
  });

  it('an unmapped or unknown kind is never muted', () => {
    expect(isKindMuted('approval', { teammates: false, news: false })).toBe(false);
    expect(isKindMuted('some_kind_invented_next_year', { teammates: false })).toBe(false);
  });

  it('all six teammate kinds are muted by the one אימוני חברי הקבוצה toggle', () => {
    // The specific question this whole change came from: turning that row off
    // has to silence the run announcements, the kudos, and the feed pings.
    for (const kind of ['kudos_activity', 'kudos', 'like', 'comment', 'mention', 'follow']) {
      expect(isKindMuted(kind, { teammates: false }), kind).toBe(true);
    }
  });
});

describe('isLedgerRow', () => {
  it('recognises the #ledger: sentinel prefix', () => {
    expect(isLedgerRow('#ledger:postWorkoutPrompt:a1:2026-08-02')).toBe(true);
    expect(isLedgerRow('#ledger:')).toBe(true);
  });

  it('a real notification url is not a ledger row', () => {
    expect(isLedgerRow('/dashboard/feed?activity=abc')).toBe(false);
    expect(isLedgerRow('/dashboard?rsvp=2026-01-05:3')).toBe(false);
  });

  it('handles a null/undefined/empty url without throwing', () => {
    expect(isLedgerRow(null)).toBe(false);
    expect(isLedgerRow(undefined)).toBe(false);
    expect(isLedgerRow('')).toBe(false);
  });

  it('only matches at the start — "#ledger:" elsewhere in the url is a real url', () => {
    expect(isLedgerRow('/dashboard/feed?note=#ledger:x')).toBe(false);
  });
});
