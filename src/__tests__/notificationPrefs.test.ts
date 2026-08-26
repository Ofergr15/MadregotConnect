import { describe, expect, it } from 'vitest';
import { isMigrationMissing, mergeWithDefaults, DEFAULTS, CATEGORIES } from '@/lib/notifications/prefs';

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
