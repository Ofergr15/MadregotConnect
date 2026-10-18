import { describe, expect, it } from 'vitest';
import { FEED_MS, LIVE_MS, MAX_CHARS, accessFor, agoHe, feedState, isReaction, mayEdit, plainText, readConfigValue, visibleLength } from '@/lib/club-updates/model';

/** "עדכונים מהמועדון": what the feed shows when, who may write and edit, and how long an update is. */
describe('club updates — the feed card', () => {
  const now = Date.parse('2026-10-18T08:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('is nothing at all when nothing was posted', () => {
    expect(feedState(null, now)).toBe('hidden');
    expect(feedState(undefined, now)).toBe('hidden');
  });
  it('is live under an hour, one line under a day, then gone', () => {
    expect(feedState(ago(5 * 60_000), now)).toBe('live');
    expect(feedState(ago(LIVE_MS + 1), now)).toBe('quiet');
    expect(feedState(ago(FEED_MS + 1), now)).toBe('hidden');
  });
});

describe('club updates — who', () => {
  const on = { enabled: true, writerIds: ['w'] };
  const off = { enabled: false, writerIds: ['w'] };
  it('while off, only the admin reads and writes', () => {
    expect(accessFor(off, 'm', false)).toEqual({ admin: false, canWrite: false, canRead: false });
    expect(accessFor(off, 'w', false).canWrite).toBe(false);
    expect(accessFor(off, 'a', true)).toEqual({ admin: true, canWrite: true, canRead: true });
  });
  it('once on, members read and the chosen writers write', () => {
    expect(accessFor(on, 'm', false)).toEqual({ admin: false, canWrite: false, canRead: true });
    expect(accessFor(on, 'w', false).canWrite).toBe(true);
  });
  it('a writer edits their own, the admin anybody\'s', () => {
    const w = accessFor(on, 'w', false);
    expect(mayEdit(w, 'w', 'w')).toBe(true);
    expect(mayEdit(w, 'w', 'other')).toBe(false);
    expect(mayEdit(accessFor(on, 'a', true), 'a', 'w')).toBe(true);
    expect(mayEdit(accessFor(on, 'm', false), 'm', 'm')).toBe(false);
  });
  it('reads a broken or missing setting as off', () => {
    expect(readConfigValue(null)).toEqual({ enabled: false, writerIds: [] });
    expect(readConfigValue('{oops')).toEqual({ enabled: false, writerIds: [] });
    expect(readConfigValue('{"enabled":"yes","writerIds":["a",3]}')).toEqual({ enabled: false, writerIds: ['a'] });
  });
});

describe('club updates — text', () => {
  const tok = '@[Shay Noam](94e838ab-76a9-4527-aecf-84cb0c67182a)';
  it('counts a mention as its @name', () => {
    expect(plainText(`${tok} סיים!`)).toBe('@Shay Noam סיים!');
    expect(visibleLength(`${tok} סיים!`)).toBe('@Shay Noam סיים!'.length);
    expect(visibleLength('א'.repeat(MAX_CHARS))).toBe(MAX_CHARS);
  });
  it('takes only the six emoji', () => {
    expect(isReaction('🔥')).toBe(true);
    expect(isReaction('💩')).toBe(false);
  });
  it('says how long ago in Hebrew', () => {
    const now = Date.parse('2026-10-18T08:00:00Z');
    expect(agoHe('2026-10-18T07:59:40Z', now)).toBe('עכשיו');
    expect(agoHe('2026-10-18T07:55:00Z', now)).toBe('לפני 5 דק׳');
    expect(agoHe('2026-10-18T06:00:00Z', now)).toBe('לפני שעתיים');
  });
});
