import { describe, it, expect } from 'vitest';
import {
  isStravaPlaceholderName,
  matchAthleteByName,
  matchAthleteByNameKey,
  stravaDisplayNameOf,
} from '@/lib/auth/athlete-identity';

// The rule: on a Strava login the roster row takes the name STRAVA holds, so the
// two sides stop drifting apart (the roster name is human-typed at registration
// and is the only handle the app has when Strava sends no email). The one thing
// that must never happen is a real name being replaced by something worse — which
// is why this returns null instead of the callback's "Strava <id>" fallback.
describe('stravaDisplayNameOf', () => {
  it('joins first and last name, which is what the club should see', () => {
    expect(stravaDisplayNameOf({ firstname: 'Ofer', lastname: 'Grosfeld' })).toBe('Ofer Grosfeld');
  });

  it('accepts a first name alone', () => {
    expect(stravaDisplayNameOf({ firstname: 'Ofer' })).toBe('Ofer');
    expect(stravaDisplayNameOf({ lastname: 'Grosfeld' })).toBe('Grosfeld');
  });

  it('trims the parts, so a stray space in a Strava profile is not copied in', () => {
    expect(stravaDisplayNameOf({ firstname: '  Ofer ', lastname: ' Grosfeld  ' })).toBe('Ofer Grosfeld');
  });

  it('keeps a non-Latin Strava name as-is — the point is one spelling, not English', () => {
    expect(stravaDisplayNameOf({ firstname: 'רועי', lastname: 'רוט' })).toBe('רועי רוט');
  });

  it('answers null when Strava says nothing, so the row keeps the name it has', () => {
    expect(stravaDisplayNameOf({})).toBeNull();
    expect(stravaDisplayNameOf({ firstname: '', lastname: '' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: '   ' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: null, lastname: null })).toBeNull();
    expect(stravaDisplayNameOf(null)).toBeNull();
    expect(stravaDisplayNameOf(undefined)).toBeNull();
  });

  // 2026-09-11: Strava returned firstname "Strava", lastname "Athlete" for a
  // member whose profile it would not share. That is not a name, and treating it
  // as one cost the club its sixth duplicate row.
  it("answers null for Strava's own placeholder, which names the source not the person", () => {
    expect(stravaDisplayNameOf({ firstname: 'Strava', lastname: 'Athlete' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: 'strava', lastname: 'athlete' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: ' Strava ', lastname: ' Athlete ' })).toBeNull();
  });

  it('does not mistake a real person whose name merely contains Strava', () => {
    expect(stravaDisplayNameOf({ firstname: 'Strava', lastname: 'Athletei' })).toBe(
      'Strava Athletei',
    );
  });
});

describe('isStravaPlaceholderName', () => {
  it('knows both placeholders — Strava’s and the one this app falls back to', () => {
    expect(isStravaPlaceholderName('Strava Athlete')).toBe(true);
    expect(isStravaPlaceholderName('STRAVA  ATHLETE')).toBe(true);
    expect(isStravaPlaceholderName('Strava 659081577')).toBe(true);
    expect(isStravaPlaceholderName('Yosi Sabag')).toBe(false);
    expect(isStravaPlaceholderName('')).toBe(false);
    expect(isStravaPlaceholderName(null)).toBe(false);
  });
});

describe('a placeholder never matches a roster row', () => {
  const roster = [
    { id: 'real', name: 'Strava Athlete', email: 'member@example.com', status: 'active' },
  ];

  // The guard is in the matchers too, not only in stravaDisplayNameOf: whatever
  // else changes upstream, "Strava Athlete" must never be the evidence that hands
  // one account to another person.
  it('by exact name', () => {
    expect(matchAthleteByName(roster, 'Strava Athlete')).toBeNull();
  });

  it('by name key', () => {
    expect(matchAthleteByNameKey(roster, 'Strava Athlete')).toBeNull();
  });
});
