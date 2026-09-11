import { describe, it, expect } from 'vitest';
import { stravaDisplayNameOf } from '@/lib/auth/athlete-identity';

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

  it('treats Strava’s own placeholder as nothing, because that is what it is', () => {
    // Undocumented, and measured in production on 2026-09-11: an account whose real
    // name Strava will not disclose comes back as firstname "Strava" / lastname
    // "Athlete". Passed through, it was written over the roster name AND announced
    // to the admin as the name of the person trying to get in.
    expect(stravaDisplayNameOf({ firstname: 'Strava', lastname: 'Athlete' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: 'strava', lastname: 'athlete' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: 'Strava' })).toBeNull();
    // And our own "Strava <id>" fallback, should it ever come back round.
    expect(stravaDisplayNameOf({ firstname: 'Strava', lastname: '659081577' })).toBeNull();
  });

  it('does not mistake a real name that merely begins with those letters', () => {
    expect(stravaDisplayNameOf({ firstname: 'Stravinsky' })).toBe('Stravinsky');
    expect(stravaDisplayNameOf({ firstname: 'Strava', lastname: 'Fanclub Dana' }))
      .toBe('Strava Fanclub Dana');
  });

  it('answers null when Strava says nothing, so the row keeps the name it has', () => {
    expect(stravaDisplayNameOf({})).toBeNull();
    expect(stravaDisplayNameOf({ firstname: '', lastname: '' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: '   ' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: null, lastname: null })).toBeNull();
    expect(stravaDisplayNameOf(null)).toBeNull();
    expect(stravaDisplayNameOf(undefined)).toBeNull();
  });
});
