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

  it('answers null when Strava says nothing, so the row keeps the name it has', () => {
    expect(stravaDisplayNameOf({})).toBeNull();
    expect(stravaDisplayNameOf({ firstname: '', lastname: '' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: '   ' })).toBeNull();
    expect(stravaDisplayNameOf({ firstname: null, lastname: null })).toBeNull();
    expect(stravaDisplayNameOf(null)).toBeNull();
    expect(stravaDisplayNameOf(undefined)).toBeNull();
  });
});
