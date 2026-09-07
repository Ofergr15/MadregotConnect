import { describe, it, expect } from 'vitest';
import {
  athleteNameKey,
  athleteNameKeys,
  matchAthleteByNameKey,
  suggestAthleteByName,
  duplicatesToFold,
  type IdentityRow,
} from '@/lib/auth/athlete-identity';

/**
 * The cross-script name match, tested against the club roster as it actually
 * stands, because this is the code that decides whether a Strava login lands on
 * somebody's real account or on a new empty one — and, now that a login can merge
 * rows by itself, whether one member is handed another member's account.
 *
 * So there are two kinds of test here and the second kind matters more: the pairs
 * that MUST match, and the pairs that must NOT. Every real roster name is in the
 * negative set, checked against every other one.
 */

// Production, 2026-09-07. Hebrew and Latin rows both, since the point is that the
// two scripts are mixed in one roster.
const ROSTER_NAMES = [
  'אסף אלקסלסי',
  'אלדר פרדו',
  'עידו בר-און',
  'רועי רוט',
  'רן אלתרמן',
  'Taly (מעצבת)',
  'Amit Lazar',
  'Ben Sitbon',
  'Eli Soffer',
  'Eylon Cohen',
  'Guy Joselson',
  'Itai Spiegel',
  'Ofer Grosfeld',
  'Sahar Azar',
  'Shahar Glazner',
  'Shalev Bahalul',
  'Tal Borenstein',
  'Yosi Sabag',
  'eyal shlomi',
  'tarkin adago',
  'yair Gabbay',
];

const row = (id: string, name: string, extra: Partial<IdentityRow> = {}): IdentityRow => ({
  id,
  name,
  email: `${id}@gmail.com`,
  status: 'active',
  ...extra,
});

const roster: IdentityRow[] = ROSTER_NAMES.map((n, i) => row(`a${i}`, n));

describe('athleteNameKey', () => {
  it('bridges the Hebrew roster name to the Latin name Strava sends', () => {
    // The pair that caused the duplicate this whole change exists for.
    expect(athleteNameKey('אסף אלקסלסי')).toBe(athleteNameKey('Asaf Elkeslassy'));
  });

  it('ignores word order, because both orders occur', () => {
    expect(athleteNameKey('Tal Borenstein')).toBe(athleteNameKey('Borenstein Tal'));
  });

  it('is unchanged by vowels, doubled letters, niqqud and punctuation', () => {
    expect(athleteNameKey('Shalev Bahalul')).toBe(athleteNameKey('Shalev Bahallul'));
    expect(athleteNameKey('עידו בר-און')).toBe(athleteNameKey('עידו בר און'));
    expect(athleteNameKey('רן אלתרמן')).toBe(athleteNameKey('רַן אַלתרמן'));
  });

  it('refuses to key a name with too little signal', () => {
    // Fewer than four consonants is not evidence of anybody. '' means "no match
    // possible", which is the safe answer, not a bug.
    expect(athleteNameKey('Dan')).toBe('');
    expect(athleteNameKey('רן')).toBe('');
    expect(athleteNameKey('')).toBe('');
    expect(athleteNameKey('🏃')).toBe('');
  });

  it('gives every distinct club member a distinct key', () => {
    const keys = new Map<string, string>();
    for (const name of ROSTER_NAMES) {
      const key = athleteNameKey(name);
      if (!key) continue;
      expect(keys.has(key), `${name} collides with ${keys.get(key)}`).toBe(false);
      keys.set(key, name);
    }
  });
});

describe('matchAthleteByNameKey', () => {
  it('finds the roster row for a first Strava login in the other script', () => {
    expect(matchAthleteByNameKey(roster, 'Asaf Elkeslassy')?.name).toBe('אסף אלקסלסי');
    expect(matchAthleteByNameKey(roster, 'Eldar Pardo')?.name).toBe('אלדר פרדו');
    expect(matchAthleteByNameKey(roster, 'Ran Alterman')?.name).toBe('רן אלתרמן');
  });

  it('matches a row that is not active yet', () => {
    // The exact-name matcher only looks at active rows, and that is how a
    // just-approved member — `invited` until they open a link the club's mail
    // cannot deliver — fell through every match and got a duplicate.
    const invited = [row('x', 'אסף אלקסלסי', { status: 'invited' })];
    expect(matchAthleteByNameKey(invited, 'Asaf Elkeslassy')?.id).toBe('x');
  });

  it('never matches a synthetic row — it is never somebody\'s real account', () => {
    const rows = [row('shell', 'Asaf Elkeslassy', { email: 'strava_60508376@strava.madregot.local' })];
    expect(matchAthleteByNameKey(rows, 'Asaf Elkeslassy')).toBeNull();
  });

  it('returns nothing rather than a guess when two rows share a key', () => {
    const rows = [row('a', 'Asaf Elkeslassy'), row('b', 'אסף אלקסלסי')];
    expect(matchAthleteByNameKey(rows, 'Asaf Elkeslassy')).toBeNull();
  });

  it('does not match one club member to another', () => {
    // The failure that matters: a wrong match hands over an account, a history and
    // possibly a staff role. Every name against every other name.
    for (const name of ROSTER_NAMES) {
      const others = roster.filter(r => r.name !== name);
      expect(matchAthleteByNameKey(others, name), `${name} matched somebody else`).toBeNull();
    }
  });

  it('does not match a stranger with a plausible name', () => {
    expect(matchAthleteByNameKey(roster, 'Michael Rodriguez')).toBeNull();
    expect(matchAthleteByNameKey(roster, 'Strava 12345')).toBeNull();
  });
});

describe('suggestAthleteByName', () => {
  it('offers a near transliteration for a human to confirm', () => {
    // One edit in the skeleton. Note that 'Elkessalsi' would match EXACTLY — the
    // reductions absorb the doubled s and the vowels — so a suggestion is only
    // needed once a consonant itself is heard differently.
    expect(suggestAthleteByName(roster, 'Asaf Elkeslasky')?.name).toBe('אסף אלקסלסי');
  });

  it('has nothing to offer for a name with too little signal', () => {
    // The honest limit of this approach. "Roey Roth" carries three consonants —
    // r · r · t — under either reading of the v/ו sound, which is below the floor,
    // so it produces no key and matches nothing. His roster row "רועי רוט" does
    // have a key, and that asymmetry is the point: matching needs BOTH sides
    // keyable, so he reaches the approval queue as an unrecognised sign-in for a
    // human to place. Quiet and visible beats a guess.
    expect(athleteNameKeys('Roey Roth')).toEqual([]);
    expect(matchAthleteByNameKey(roster, 'Roey Roth')).toBeNull();
    expect(suggestAthleteByName(roster, 'Roey Roth')).toBeNull();
  });

  it('stays quiet when the name matches exactly — the caller already knows', () => {
    expect(suggestAthleteByName(roster, 'Asaf Elkeslassy')).toBeNull();
  });

  it('stays quiet when two rows are equally close', () => {
    const rows = [row('a', 'Tal Borenstein'), row('b', 'Tal Borensteen')];
    expect(suggestAthleteByName(rows, 'Tal Borenstain')).toBeNull();
  });
});

describe('duplicatesToFold', () => {
  const real = row('real', 'אסף אלקסלסי');
  const shell = row('shell', 'Asaf Elkeslassy', {
    email: 'strava_60508376@strava.madregot.local',
  });

  it('returns the synthetic shells beside the row being kept', () => {
    expect(duplicatesToFold([real, shell], real).map(r => r.id)).toEqual(['shell']);
  });

  it('never returns a row with a real address, whatever the caller believes', () => {
    // The guard that keeps an automatic login handler from deleting an account.
    // Two real rows for one person is an admin's merge to confirm, not a login's.
    const other = row('other', 'Asaf Elkeslassy');
    expect(duplicatesToFold([real, other], real)).toEqual([]);
  });

  it('never returns the row being kept', () => {
    expect(duplicatesToFold([shell], shell)).toEqual([]);
  });
});
