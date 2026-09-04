import { describe, it, expect } from 'vitest';
import {
  isSyntheticAuthEmail,
  matchAthleteByName,
  normalizeAthleteName,
  pickAthleteRow,
  stravaIdFromAuthEmail,
  type IdentityRow,
} from '../lib/auth/athlete-identity';

// The rows below are the production ones, because the bug was not hypothetical:
// four club members had two athlete rows each, and every Strava login resolved
// to the empty duplicate. Three of the four were admins, so they signed in as
// brand-new runners with no group, no history and no staff tools.
const REAL_OFER: IdentityRow = {
  id: '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81',
  name: 'Ofer G',
  email: 'grosfeldofer@gmail.com',
  role: 'admin',
  status: 'active',
  created_at: '2026-07-12T06:56:31Z',
  strava_athlete_id: 106828158,
  strava_auth: { token: 'x' },
  garmin_auth: { token: 'y' },
};
const DUP_OFER: IdentityRow = {
  id: '6eb4de98-270e-4ddd-9161-db71fff031f7',
  name: 'Ofer Grosfeld',
  email: 'strava_106828158@strava.madregot.local',
  role: 'runner',
  status: 'active',
  created_at: '2026-08-21T20:03:00Z',
  strava_athlete_id: null,
  strava_auth: null,
  garmin_auth: null,
};

describe('stravaIdFromAuthEmail', () => {
  it('recovers the identity from the synthetic address', () => {
    expect(stravaIdFromAuthEmail('strava_106828158@strava.madregot.local')).toBe(106828158);
    expect(stravaIdFromAuthEmail('STRAVA_37085164@STRAVA.MADREGOT.LOCAL')).toBe(37085164);
    expect(stravaIdFromAuthEmail('  strava_17293893@strava.madregot.local ')).toBe(17293893);
  });

  it('returns null for a real address, so nothing else changes behaviour', () => {
    expect(stravaIdFromAuthEmail('grosfeldofer@gmail.com')).toBeNull();
    expect(stravaIdFromAuthEmail('test-coach@madregot.local')).toBeNull();
    expect(stravaIdFromAuthEmail('')).toBeNull();
    expect(stravaIdFromAuthEmail(null)).toBeNull();
    // Not our pattern: no id, or an id that isn't one.
    expect(stravaIdFromAuthEmail('strava_@strava.madregot.local')).toBeNull();
    expect(stravaIdFromAuthEmail('strava_abc@strava.madregot.local')).toBeNull();
    expect(stravaIdFromAuthEmail('strava_0@strava.madregot.local')).toBeNull();
  });

  it('drives isSyntheticAuthEmail', () => {
    expect(isSyntheticAuthEmail(DUP_OFER.email)).toBe(true);
    expect(isSyntheticAuthEmail(REAL_OFER.email)).toBe(false);
  });
});

describe('pickAthleteRow — which row a login belongs to', () => {
  it('picks the real row over the duplicate that owns the synthetic address', () => {
    // The regression, pinned. Both rows match this login (one on Strava id, one
    // on email); resolve-role used to return the duplicate and the app treated
    // an admin as a new runner with nothing connected.
    for (const rows of [[DUP_OFER, REAL_OFER], [REAL_OFER, DUP_OFER]]) {
      expect(pickAthleteRow(rows, 106828158)?.id).toBe(REAL_OFER.id);
    }
  });

  it('is order-independent and null-safe', () => {
    expect(pickAthleteRow([], 106828158)).toBeNull();
    expect(pickAthleteRow([DUP_OFER], 106828158)?.id).toBe(DUP_OFER.id);
  });

  it('prefers the Strava identity over credentials on another row', () => {
    // A row whose strava_athlete_id matches IS this person, even if some other
    // row looks better connected.
    const other: IdentityRow = {
      ...DUP_OFER,
      id: 'other',
      strava_auth: { token: 'z' },
      garmin_auth: { token: 'z' },
    };
    expect(pickAthleteRow([other, REAL_OFER], 106828158)?.id).toBe(REAL_OFER.id);
  });

  it('prefers a real email over a synthetic one when neither carries the id', () => {
    const real = { ...REAL_OFER, strava_athlete_id: null, strava_auth: null, garmin_auth: null };
    expect(pickAthleteRow([DUP_OFER, real], 106828158)?.id).toBe(real.id);
  });

  it('never signs a coach in as a runner', () => {
    const runner: IdentityRow = { ...DUP_OFER, id: 'runner-row', email: 'a@b.com', role: 'runner' };
    const coach: IdentityRow = { ...DUP_OFER, id: 'coach-row', email: 'c@d.com', role: 'coach' };
    expect(pickAthleteRow([runner, coach], null)?.id).toBe('coach-row');
  });

  it('falls back to the older row only when everything else ties', () => {
    const older: IdentityRow = { ...DUP_OFER, id: 'older', created_at: '2026-01-01T00:00:00Z' };
    const newer: IdentityRow = { ...DUP_OFER, id: 'newer', created_at: '2026-08-01T00:00:00Z' };
    expect(pickAthleteRow([newer, older], null)?.id).toBe('older');
  });

  it('works with no strava id at all (a Google/password login)', () => {
    expect(pickAthleteRow([REAL_OFER, DUP_OFER])?.id).toBe(REAL_OFER.id);
  });
});

describe('matchAthleteByName — the first-Strava-login bridge', () => {
  const roster: IdentityRow[] = [
    { id: 'tal', name: 'Tal Borenstein', email: 'talboren2@gmail.com', role: 'admin', status: 'active' },
    { id: 'sahar', name: 'Sahar Azar', email: 'sazar69@gmail.com', role: 'runner', status: 'active' },
    { id: 'amit', name: 'Amit Lazar', email: 'amitlazar315@gmail.com', role: 'runner', status: 'active' },
    { id: 'gone', name: 'Old Member', email: 'old@x.com', role: 'runner', status: 'inactive' },
  ];

  it('matches the roster row a Strava profile name belongs to', () => {
    expect(matchAthleteByName(roster, 'Tal Borenstein')?.id).toBe('tal');
    // Strava's spacing and casing are not the coach's.
    expect(matchAthleteByName(roster, '  tal   borenstein ')?.id).toBe('tal');
  });

  it('refuses a partial name — that would hand over the wrong account', () => {
    expect(matchAthleteByName(roster, 'Tal')).toBeNull();
    expect(matchAthleteByName(roster, 'Azar')).toBeNull();
    expect(matchAthleteByName(roster, 'Sahar')).toBeNull();
  });

  it('refuses an ambiguous match and ignores inactive rows', () => {
    const twins = [...roster, { id: 'tal2', name: 'Tal Borenstein', email: 't2@x.com', status: 'active' }];
    expect(matchAthleteByName(twins, 'Tal Borenstein')).toBeNull();
    expect(matchAthleteByName(roster, 'Old Member')).toBeNull();
  });

  it('refuses an empty name rather than matching a nameless row', () => {
    const nameless = [{ id: 'blank', name: null, email: 'b@x.com', status: 'active' }];
    expect(matchAthleteByName(nameless, '')).toBeNull();
    expect(matchAthleteByName(nameless, null)).toBeNull();
  });

  it('normalises Hebrew composition, so both spellings of a name compare equal', () => {
    // The same string composed and decomposed — typed by a coach vs. sent by an API.
    const composed = 'שחר גלזנר';
    expect(normalizeAthleteName(composed.normalize('NFD'))).toBe(normalizeAthleteName(composed));
    const heb = [{ id: 'h', name: composed, email: 'h@x.com', status: 'active' }];
    expect(matchAthleteByName(heb, composed.normalize('NFD'))?.id).toBe('h');
  });
});
