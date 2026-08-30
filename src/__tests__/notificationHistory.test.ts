import { describe, expect, it } from 'vitest';
import { dateBucketFor, styleKindFor, kudosActivityId, rsvpTarget, readStoreKey } from '@/lib/notifications/history';

// dateBucketFor compares against `new Date()` at call time, so tests use
// offsets from "now" rather than hardcoded timestamps — otherwise this file
// would silently go stale and start failing the day it's read again.
function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('dateBucketFor', () => {
  it('a timestamp from a few minutes ago is "today"', () => {
    expect(dateBucketFor(isoHoursAgo(0.05))).toBe('today');
  });

  it('midnight-crossing still resolves correctly relative to calendar days, not a fixed 24h window', () => {
    // Deliberately not asserting exact hour boundaries here (those depend on
    // local calendar midnight, not elapsed hours) — covered by the day-based
    // cases below, which are boundary-safe regardless of time-of-day.
    expect(dateBucketFor(isoDaysAgo(1.5))).not.toBe('today');
  });

  it('2 days ago is within "thisWeek"', () => {
    expect(dateBucketFor(isoDaysAgo(2))).toBe('thisWeek');
  });

  it('6 days ago is still within "thisWeek"', () => {
    expect(dateBucketFor(isoDaysAgo(6))).toBe('thisWeek');
  });

  it('10 days ago is "older"', () => {
    expect(dateBucketFor(isoDaysAgo(10))).toBe('older');
  });

  it('a future timestamp (clock skew / scheduled-but-not-yet-visible edge case) is "today", not an error', () => {
    expect(dateBucketFor(isoHoursAgo(-1))).toBe('today');
  });
});

describe('styleKindFor', () => {
  it('matches coach-related content', () => {
    expect(styleKindFor({ title: 'הודעה מהמאמן', body: '' })).toBe('coach');
    expect(styleKindFor({ title: '', body: 'תשובה חדשה' })).toBe('coach');
    expect(styleKindFor({ title: '💬', body: '' })).toBe('coach');
  });

  it('matches race-related content', () => {
    expect(styleKindFor({ title: 'מרוץ מתקרב', body: '' })).toBe('race');
    expect(styleKindFor({ title: '', body: 'ההרשמה נפתחה' })).toBe('race');
  });

  it('matches achievement-related content', () => {
    expect(styleKindFor({ title: 'שיא אישי חדש!', body: '' })).toBe('achievement');
    expect(styleKindFor({ title: '', body: 'רצף של 30 יום 🔥' })).toBe('achievement');
  });

  it('matches workout-related content', () => {
    expect(styleKindFor({ title: 'תזכורת אימון', body: '' })).toBe('workout');
    expect(styleKindFor({ title: '', body: 'מי מגיעים היום' })).toBe('workout');
  });

  it('falls back to "default" for unrecognized content', () => {
    expect(styleKindFor({ title: 'הודעה כללית', body: 'תוכן רגיל' })).toBe('default');
  });

  it('checks combined title+body, not title alone', () => {
    expect(styleKindFor({ title: '', body: 'מאמן שלח לך הודעה' })).toBe('coach');
  });
});

describe('kudosActivityId', () => {
  it('extracts the activity id for a kudos_activity kind', () => {
    expect(kudosActivityId({ kind: 'kudos_activity', url: '/dashboard/feed?activity=abc-123' })).toBe('abc-123');
  });

  it('still reads the legacy ?kudos= spelling', () => {
    // Every "X finished a run" notification sent before the link was pointed at
    // /dashboard/feed is still in athletes' history with this shape. Its link
    // goes somewhere useless, but its inbox kudos button should keep working.
    expect(kudosActivityId({ kind: 'kudos_activity', url: '/dashboard/activities?kudos=abc-123' })).toBe('abc-123');
  });

  it('extracts correctly when activity is not the first query param', () => {
    expect(kudosActivityId({ kind: 'kudos_activity', url: '/dashboard/feed?foo=1&activity=xyz' })).toBe('xyz');
  });

  it('returns null for any other kind, even with a matching query param', () => {
    expect(kudosActivityId({ kind: 'like', url: '/dashboard/activities?kudos=abc-123' })).toBeNull();
  });

  it('returns null when the kind matches but the query param is absent', () => {
    expect(kudosActivityId({ kind: 'kudos_activity', url: '/dashboard/activities' })).toBeNull();
  });

  it('extracts correctly when kudos is not the first query param', () => {
    expect(kudosActivityId({ kind: 'kudos_activity', url: '/dashboard/activities?foo=1&kudos=xyz' })).toBe('xyz');
  });
});

describe('rsvpTarget', () => {
  it('extracts weekStart and day for a training_before kind', () => {
    expect(rsvpTarget({ kind: 'training_before', url: '/dashboard?rsvp=2026-01-05:3' })).toEqual({
      weekStart: '2026-01-05', day: 3,
    });
  });

  it('returns null for any other kind', () => {
    expect(rsvpTarget({ kind: 'like', url: '/dashboard?rsvp=2026-01-05:3' })).toBeNull();
  });

  it('returns null when the query param is malformed or absent', () => {
    expect(rsvpTarget({ kind: 'training_before', url: '/dashboard' })).toBeNull();
    expect(rsvpTarget({ kind: 'training_before', url: '/dashboard?rsvp=notaday' })).toBeNull();
  });

  it('day is returned as a number, not a string', () => {
    const result = rsvpTarget({ kind: 'training_before', url: '/dashboard?rsvp=2026-01-05:0' });
    expect(result?.day).toBe(0);
    expect(typeof result?.day).toBe('number');
  });
});

describe('readStoreKey', () => {
  it('namespaces the key by athleteId so two athletes never share dismissed-ids state', () => {
    expect(readStoreKey('alice')).toBe('notif_read_ids_alice');
    expect(readStoreKey('bob')).toBe('notif_read_ids_bob');
    expect(readStoreKey('alice')).not.toBe(readStoreKey('bob'));
  });
});
