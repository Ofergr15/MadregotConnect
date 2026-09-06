import { describe, expect, it } from 'vitest';
import { defaultsFor, isKindMuted, KIND_CATEGORY, mergeWithDefaults } from '@/lib/notifications/prefs';
import { computeMutedAthleteIds, countsTowardBadge } from '@/lib/push';

// An admin's notifications were the club's social firehose — kudos_activity is
// two thirds of every row ever written, and an admin follows more people than
// anyone. These tests pin the two halves of the fix: staff default to quiet on
// the social channel, and the four management alerts have a channel at all.

describe('defaultsFor', () => {
  it('an athlete gets everything on', () => {
    expect(defaultsFor(false)).toMatchObject({ teammates: true, management: true });
  });

  it('staff get the social channel off and management on', () => {
    expect(defaultsFor(true)).toMatchObject({ teammates: false, management: true });
  });

  it('never mutates the shared DEFAULTS object across calls', () => {
    defaultsFor(true);
    expect(defaultsFor(false).teammates).toBe(true);
  });
});

describe('isKindMuted — the untouched-preference baseline', () => {
  // This is the whole point of the change. EVERY existing coach has no saved
  // notification_prefs at all, so if a missing object short-circuits to "not
  // muted" the staff default is dead code that can never fire.
  it('mutes a social kind for staff who have never opened the settings screen', () => {
    expect(isKindMuted('kudos_activity', null, true)).toBe(true);
    expect(isKindMuted('kudos_activity', undefined, true)).toBe(true);
    expect(isKindMuted('kudos_activity', {}, true)).toBe(true);
  });

  it('does not mute the same kind for an athlete with no saved preferences', () => {
    expect(isKindMuted('kudos_activity', null, false)).toBe(false);
  });

  it('an explicit true wins over the staff default — a coach can opt back in', () => {
    expect(isKindMuted('kudos_activity', { teammates: true }, true)).toBe(false);
  });

  it('an explicit false always mutes, staff or not', () => {
    expect(isKindMuted('kudos_activity', { teammates: false }, false)).toBe(true);
  });

  it('management alerts reach staff by default and are still muteable', () => {
    expect(isKindMuted('signup_request', null, true)).toBe(false);
    expect(isKindMuted('signup_request', { management: false }, true)).toBe(true);
  });

  it('an unrecognised kind is never muted', () => {
    expect(isKindMuted('something_new', { management: false }, true)).toBe(false);
  });
});

describe('KIND_CATEGORY covers every management alert', () => {
  // A kind with no entry here is invisible to the mute check, so the toggle in
  // Settings would silence the push and leave the badge climbing.
  it.each(['signup_request', 'problem_report', 'workout_delivery_failed', 'sync_stalled', 'store_order', 'feedback_alert'])(
    '%s belongs to the management channel',
    (kind) => {
      expect(KIND_CATEGORY[kind]).toBe('management');
    },
  );

  it('leaves the two un-muteable kinds out on purpose', () => {
    expect(KIND_CATEGORY['approval']).toBeUndefined();
    expect(KIND_CATEGORY['review_resolved']).toBeUndefined();
  });
});

describe('computeMutedAthleteIds — role-aware', () => {
  it('mutes a coach with no saved prefs from a teammates push, but not a runner', () => {
    const muted = computeMutedAthleteIds(
      [{ id: 'coach' as string, role: 'coach' }, { id: 'runner', role: 'runner' }],
      'teammates',
    );
    expect([...muted]).toEqual(['coach']);
  });

  it('respects a coach who explicitly opted back in', () => {
    const muted = computeMutedAthleteIds(
      [{ id: 'coach', role: 'coach', notification_prefs: { teammates: true } }],
      'teammates',
    );
    expect(muted.size).toBe(0);
  });

  it('does not quiet the management channel for anyone', () => {
    const muted = computeMutedAthleteIds([{ id: 'coach', role: 'admin' }], 'management');
    expect(muted.size).toBe(0);
  });
});

describe('countsTowardBadge — the badge agrees with the send path', () => {
  const SINCE = '2026-08-01T00:00:00Z';
  const notif = (kind: string) => ({
    kind,
    url: '/dashboard/feed?activity=1',
    audience_type: 'athlete',
    audience_id: 'a1',
    last_sent_at: '2026-08-02T00:00:00Z',
  });

  it('a social row does not count for a coach who never touched the settings', () => {
    expect(countsTowardBadge(notif('kudos_activity'), { group_id: null, role: 'coach' }, 'a1', SINCE)).toBe(false);
  });

  it('the same row counts for a runner', () => {
    expect(countsTowardBadge(notif('kudos_activity'), { group_id: null, role: 'runner' }, 'a1', SINCE)).toBe(true);
  });

  it('a management row counts for a coach', () => {
    expect(countsTowardBadge(notif('problem_report'), { group_id: null, role: 'coach' }, 'a1', SINCE)).toBe(true);
  });
});

describe('mergeWithDefaults', () => {
  it('shows a coach the quiet baseline for a category they never set', () => {
    expect(mergeWithDefaults({ coach: false }, true)).toMatchObject({ teammates: false, coach: false });
  });

  it('passes the notification language straight through', () => {
    expect(mergeWithDefaults({ language: 'en' }, true).language).toBe('en');
  });
});
