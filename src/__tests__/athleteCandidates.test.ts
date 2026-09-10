import { describe, it, expect } from 'vitest';
import {
  athleteNameKeys,
  matchAthleteByNameKey,
  rankAthleteCandidates,
  suggestAthleteByName,
  type IdentityRow,
} from '@/lib/auth/athlete-identity';

/**
 * The approval queue's candidate list — the fix for the fifth production duplicate.
 *
 * MEASURED, 2026-09-08/09: `רועי רוט` (roy.m.roth@gmail.com, in the club since July,
 * 2872 activities back to 2014) signed in with Strava, which sent the display name
 * "Roy Roth". Every automatic matcher declined, correctly and for the same reason:
 * `athleteNameKeys('Roy Roth')` is `[]`, because the consonant skeleton carries
 * three letters and `long()` requires four. What was NOT correct is that the
 * approval queue then showed nothing at all — it asked those same strict matchers
 * for its hint — so the row was approved as a new member 35 seconds after it
 * arrived. Two accounts for one runner, both syncing Garmin, 211 runs stored twice.
 *
 * The floor is not the bug and is deliberately still here (see the last test in the
 * first block). The bug was a screen with no answer on it, and these tests pin the
 * asymmetry that fixes it: the strict path stays silent, the display path always
 * ranks.
 */

const row = (id: string, name: string, email: string, over: Partial<IdentityRow> = {}): IdentityRow => ({
  id,
  name,
  email,
  status: 'active',
  role: 'runner',
  created_at: '2026-07-01T00:00:00Z',
  ...over,
});

/** The real club roster, in the shape that produced the incident. */
const ROSTER: IdentityRow[] = [
  row('roy', 'רועי רוט', 'roy.m.roth@gmail.com'),
  row('asaf', 'אסף אלקסלסי', 'akonsta1313@gmail.com'),
  row('dan', 'דן לוי', 'dan@example.com'),
  row('ofer', 'עופר גרוספלד', 'grosfeldofer@gmail.com', { role: 'admin' }),
  // The shell the callback created for Roy. Never a destination, never a candidate.
  row('shell', 'Roy Roth', 'strava_36749505@strava.madregot.local'),
];

const others = ROSTER.filter(r => r.id !== 'shell');

describe('rankAthleteCandidates — the name the strict matchers cannot touch', () => {
  it('offers רועי רוט for a "Roy Roth" sign-in', () => {
    const found = rankAthleteCandidates(others, 'Roy Roth');
    expect(found.map(c => c.row.id)).toContain('roy');
    expect(found[0].row.id).toBe('roy');
  });

  it('still ranks a misspelled transliteration', () => {
    expect(rankAthleteCandidates(others, 'Roey Roth')[0].row.id).toBe('roy');
    expect(rankAthleteCandidates(others, 'Roi Rot')[0].row.id).toBe('roy');
  });

  // The whole point, stated as one assertion: the queue answers where the automatic
  // path refuses to, and the automatic path has NOT been loosened to achieve it.
  it('answers exactly where the strict matchers return nothing', () => {
    expect(athleteNameKeys('Roy Roth')).toEqual([]);
    expect(matchAthleteByNameKey(others, 'Roy Roth')).toBeNull();
    expect(suggestAthleteByName(others, 'Roy Roth')).toBeNull();
    expect(rankAthleteCandidates(others, 'Roy Roth').length).toBeGreaterThan(0);
  });
});

describe('rankAthleteCandidates — what it will and will not put on the screen', () => {
  it('finds a cross-script match the automatic path also finds', () => {
    expect(rankAthleteCandidates(others, 'Asaf Elkeslassy')[0].row.id).toBe('asaf');
  });

  it('never offers a synthetic shell as a destination', () => {
    // 'Roy Roth' is the shell's own name, so an unfiltered ranker would put it
    // first — and merging a shell into a shell loses the roster row entirely.
    const ids = rankAthleteCandidates(ROSTER, 'Roy Roth').map(c => c.row.id);
    expect(ids).not.toContain('shell');
  });

  it('returns nothing for somebody genuinely new', () => {
    expect(rankAthleteCandidates(others, 'Zaphod Beeblebrox')).toEqual([]);
  });

  it('returns nothing for a name with no letters in it', () => {
    expect(rankAthleteCandidates(others, '')).toEqual([]);
    expect(rankAthleteCandidates(others, '   ')).toEqual([]);
    expect(rankAthleteCandidates(others, null)).toEqual([]);
  });

  it('caps the list so a queue row stays a row', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`r${i}`, 'רועי רוט', `r${i}@example.com`));
    expect(rankAthleteCandidates(many, 'Roy Roth').length).toBe(3);
    expect(rankAthleteCandidates(many, 'Roy Roth', 1).length).toBe(1);
  });
});

describe('confidence — the word the screen shows instead of a score', () => {
  it('calls an identical skeleton exact', () => {
    expect(rankAthleteCandidates(others, 'Asaf Elkeslassy')[0].confidence).toBe('exact');
  });

  it('calls a one-edit transliteration near', () => {
    // One consonant away from אלקסלסי, which is precisely the case suggestAthleteByName
    // exists for — so the label has to agree with it rather than overclaim.
    const hit = rankAthleteCandidates(others, 'Asaf Elkeslasti')[0];
    expect(hit.row.id).toBe('asaf');
    expect(hit.confidence).toBe('near');
  });

  it('calls a surname-only resemblance weak, and ranks it below a strong one', () => {
    const roster = [
      row('roy', 'רועי רוט', 'roy.m.roth@gmail.com'),
      // Shares only the surname skeleton with "Amit Grosfeld".
      row('ofer', 'עופר גרוספלד', 'grosfeldofer@gmail.com'),
    ];
    const weak = rankAthleteCandidates(roster, 'Amit Grosfeld');
    expect(weak[0].row.id).toBe('ofer');
    expect(weak[0].confidence).toBe('weak');

    // A strong match must come first when both are present.
    const mixed = rankAthleteCandidates(
      [...roster, row('grosfeld', 'עמית גרוספלד', 'amit@example.com')],
      'Amit Grosfeld',
    );
    expect(mixed[0].row.id).toBe('grosfeld');
    expect(mixed[0].confidence).toBe('exact');
    expect(mixed.map(c => c.confidence).indexOf('weak')).toBeGreaterThan(0);
  });

  it('treats a roster row holding only a first name as weak, not certain', () => {
    // A real shape in this club's data: somebody typed "רועי" at registration.
    const hit = rankAthleteCandidates([row('r', 'רועי', 'r@example.com')], 'Roy Roth')[0];
    expect(hit.confidence).toBe('weak');
  });
});
