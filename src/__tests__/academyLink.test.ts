import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_SUGGESTIONS,
  RECENT_REGISTRATION_DAYS,
  clubMatchFor,
  filterAthletes,
  isFormMadeAccount,
  isSyntheticEmail,
  normalizeEmail,
  normalizePhone,
  suggestAthleteLinks,
  type LinkableAthlete,
  type LinkableCandidate,
} from '@/lib/academy/link';

const DAY = 86_400_000;
const CALL = '2026-09-01T09:00:00Z';
const at = (daysAfterCall: number) => new Date(Date.parse(CALL) + daysAfterCall * DAY).toISOString();

const candidate = (over: Partial<LinkableCandidate> = {}): LinkableCandidate => ({
  id: 'c1',
  name: 'אבי ברק',
  ...over,
});

const athlete = (over: Partial<LinkableAthlete> & { id: string }): LinkableAthlete => ({
  name: 'Someone Else',
  createdAt: at(200),
  ...over,
});

describe('reading a phone number', () => {
  // The same Israeli mobile, written the four ways it gets written. A candidate's number is
  // typed by hand mid-call; an athlete's came off a form. They have to reduce to one string.
  it.each(['050-123-4567', '0501234567', '+972-50-123-4567', '972501234567', ' 050 123 4567 '])(
    'reduces %s to one form',
    raw => expect(normalizePhone(raw)).toBe('0501234567'),
  );

  it('refuses a fragment', () => {
    // `050` would make every mobile in the club the same person.
    expect(normalizePhone('050')).toBeNull();
    expect(normalizePhone('12345678')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('keeps a landline that is long enough', () => {
    expect(normalizePhone('04-8123456')).toBe('048123456');
  });
});

describe('reading an email', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Avi@Example.COM ')).toBe('avi@example.com');
  });

  it('is null for something that is not an address', () => {
    expect(normalizeEmail('avi')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it('knows a fabricated Strava address from a real one', () => {
    expect(isSyntheticEmail('strava_12345@strava.madregot.local')).toBe(true);
    expect(isSyntheticEmail('avi@example.com')).toBe(false);
  });
});

describe('suggesting who the candidate became', () => {
  it('matches on email, and says so', () => {
    const out = suggestAthleteLinks(candidate({ email: 'AVI@example.com' }), [
      athlete({ id: 'a1', name: 'Dana Cohen', email: 'dana@example.com' }),
      athlete({ id: 'a2', name: 'Avi Barak', email: 'avi@example.com' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].athlete.id).toBe('a2');
    expect(out[0].reason).toBe('email');
    expect(out[0].confidence).toBe('exact');
  });

  it('matches on phone across two spellings of one number', () => {
    const out = suggestAthleteLinks(candidate({ phone: '050-123-4567' }), [
      athlete({ id: 'a1', phone: '+972501234567' }),
    ]);
    expect(out[0]).toMatchObject({ reason: 'phone', confidence: 'exact' });
  });

  it('matches a Hebrew candidate name against a Latin roster name, as a suggestion', () => {
    // `אבי ברק` and `Avi Barak` share no character. The consonant skeletons that join Strava
    // logins to the roster bridge them — the key for a member whose account carries a
    // placeholder address that email can never find.
    const out = suggestAthleteLinks(candidate({ name: 'אבי ברק' }), [athlete({ id: 'a1', name: 'Avi Barak' })]);
    expect(out[0]).toMatchObject({ reason: 'name', confidence: 'likely', text: 'אותו שם, בעברית ובאנגלית' });
  });

  it('does not match unrelated names across scripts', () => {
    const out = suggestAthleteLinks(candidate({ name: 'אבי ברק' }), [athlete({ id: 'a1', name: 'Dana Cohen' })]);
    expect(out).toEqual([]);
  });

  it('does match a name when the candidate was typed in Latin too', () => {
    const out = suggestAthleteLinks(candidate({ name: 'avi  BARAK' }), [athlete({ id: 'a1', name: 'Avi Barak' })]);
    expect(out[0]).toMatchObject({ reason: 'name', confidence: 'likely' });
  });

  it('will not treat a fabricated Strava address as evidence', () => {
    // Two Strava logins with no real email can even agree with each other.
    const out = suggestAthleteLinks(
      candidate({ email: 'strava_9@strava.madregot.local' }),
      [athlete({ id: 'a1', email: 'strava_9@strava.madregot.local' })],
    );
    expect(out).toEqual([]);
  });

  it('offers whoever registered around the time of the call, weakly', () => {
    const out = suggestAthleteLinks(candidate(), [athlete({ id: 'a1', createdAt: at(3) })], { since: CALL });
    expect(out[0]).toMatchObject({ reason: 'recent', confidence: 'weak' });
    // Says what the distance is measured FROM. `נרשם לפני 3 ימים` is a different claim —
    // three days before today — and it happens to be false.
    expect(out[0].text).toBe('נרשם 3 ימים אחרי השיחה');
  });

  it('agrees with its own number', () => {
    // `1 ימים` is the line that tells a reader a machine wrote the screen.
    const out = suggestAthleteLinks(
      candidate(),
      [athlete({ id: 'after', createdAt: at(1) }), athlete({ id: 'before', createdAt: at(-1) })],
      { since: CALL },
    );
    expect(out.map(m => m.text)).toEqual(['נרשם יום אחרי השיחה', 'נרשם יום לפני השיחה']);
  });

  it('says the day of the call rather than לפני 0 ימים', () => {
    const out = suggestAthleteLinks(candidate(), [athlete({ id: 'a1', createdAt: at(0.2) })], { since: CALL });
    expect(out[0].text).toBe('נרשם ביום השיחה');
  });

  it('counts a registration BEFORE the call as just as close, and says which side', () => {
    // People register and then get called, and also the other way round. The distance is what
    // ranks the row; the direction is what makes it believable.
    const out = suggestAthleteLinks(candidate(), [athlete({ id: 'a1', createdAt: at(-4) })], { since: CALL });
    expect(out[0]).toMatchObject({ reason: 'recent', text: 'נרשם 4 ימים לפני השיחה' });
  });

  it('drops a registration from another season', () => {
    const out = suggestAthleteLinks(
      candidate(),
      [athlete({ id: 'a1', createdAt: at(RECENT_REGISTRATION_DAYS + 1) })],
      { since: CALL },
    );
    expect(out).toEqual([]);
  });

  it('skips recency entirely with nothing to measure from', () => {
    // Measuring from the wrong end would offer the whole roster in the wrong order, which
    // reads as an answer. No answer is better.
    expect(suggestAthleteLinks(candidate(), [athlete({ id: 'a1', createdAt: at(1) })])).toEqual([]);
  });

  it('caps the recency tail', () => {
    const many = Array.from({ length: 12 }, (_, i) => athlete({ id: `a${i}`, createdAt: at(i * 0.5) }));
    expect(suggestAthleteLinks(candidate(), many, { since: CALL })).toHaveLength(MAX_RECENT_SUGGESTIONS);
  });

  it('puts an academy-flagged registration ahead of a slightly closer one', () => {
    // Somebody who came through `/academy-register` is already holding up a hand.
    const out = suggestAthleteLinks(
      candidate(),
      [
        athlete({ id: 'club', createdAt: at(1) }),
        athlete({ id: 'academy', createdAt: at(5), isAcademy: true }),
      ],
      { since: CALL },
    );
    expect(out.map(m => m.athlete.id)).toEqual(['academy', 'club']);
    // And SAYS why it is ahead, in both the badge and the words. The order on its own reads as
    // a sort bug: the row on top registered four days further from the call than the row below.
    expect(out[0]).toMatchObject({ confidence: 'likely', text: 'נרשם לאקדמיה 5 ימים אחרי השיחה' });
    expect(out[1]).toMatchObject({ confidence: 'weak', text: 'נרשם יום אחרי השיחה' });
  });

  it('ranks an exact match above a close registration date', () => {
    const out = suggestAthleteLinks(
      candidate({ email: 'avi@example.com' }),
      [
        athlete({ id: 'recent', createdAt: at(0) }),
        athlete({ id: 'exact', email: 'avi@example.com', createdAt: at(300) }),
      ],
      { since: CALL },
    );
    expect(out[0].athlete.id).toBe('exact');
  });

  it('never offers the athlete this candidate is already joined to', () => {
    const out = suggestAthleteLinks(
      candidate({ email: 'avi@example.com', athleteId: 'a1' }),
      [athlete({ id: 'a1', email: 'avi@example.com' })],
      { since: CALL },
    );
    expect(out).toEqual([]);
  });

  it('shows an exact match that belongs to another candidate, marked taken', () => {
    // The unique index would refuse this link with a 409, and the sheet must say so BEFORE
    // the tap. It is also the useful signal: one email across two candidate rows is a
    // duplicate candidate.
    const out = suggestAthleteLinks(
      candidate({ email: 'avi@example.com' }),
      [athlete({ id: 'a1', email: 'avi@example.com' })],
      { takenBy: { a1: 'other-candidate' } },
    );
    expect(out[0]).toMatchObject({ taken: true, reason: 'email' });
  });

  it('hides a WEAK suggestion that belongs to another candidate', () => {
    // A disabled row with a weak reason is a question nobody can answer.
    const out = suggestAthleteLinks(candidate(), [athlete({ id: 'a1', createdAt: at(1) })], {
      since: CALL,
      takenBy: { a1: 'other-candidate' },
    });
    expect(out).toEqual([]);
  });

  it('offers each athlete once even when two keys agree', () => {
    const out = suggestAthleteLinks(
      candidate({ email: 'avi@example.com', phone: '0501234567', name: 'Avi Barak' }),
      [athlete({ id: 'a1', name: 'Avi Barak', email: 'avi@example.com', phone: '0501234567', createdAt: at(1) })],
      { since: CALL },
    );
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('email');
  });
});

describe('searching the roster', () => {
  const roster = [
    athlete({ id: 'a1', name: 'David Levi', email: 'david@example.com' }),
    athlete({ id: 'a2', name: 'Dana Cohen', email: 'dana@example.com' }),
    athlete({ id: 'a3', name: 'Ron Shemesh', email: 'strava_3@strava.madregot.local' }),
  ];

  it('finds a partial name, which matching deliberately would not', () => {
    expect(filterAthletes(roster, 'dav').map(a => a.id)).toEqual(['a1']);
  });

  it('finds an address', () => {
    expect(filterAthletes(roster, 'dana@').map(a => a.id)).toEqual(['a2']);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(filterAthletes(roster, '  RON ').map(a => a.id)).toEqual(['a3']);
  });

  it('will not find somebody by their fabricated address', () => {
    // Searching `strava_` would return a list of people whose only shared trait is how they
    // logged in, presented as if it meant something.
    expect(filterAthletes(roster, 'strava_')).toEqual([]);
  });

  it('returns the whole roster for an empty query', () => {
    expect(filterAthletes(roster, '   ')).toHaveLength(3);
  });
});

describe('the club member a form applicant probably is', () => {
  const members = [
    athlete({ id: 'm1', name: 'Avi Barak', email: 'strava_1@strava.madregot.local', hasStrava: true }),
    athlete({ id: 'm2', name: 'Dana Cohen', email: 'dana@example.com' }),
  ];

  it('finds the Strava member by name across scripts', () => {
    expect(clubMatchFor(candidate({ name: 'אבי ברק' }), members)?.athlete.id).toBe('m1');
  });

  it('prefers the one exact match', () => {
    expect(clubMatchFor(candidate({ name: 'Someone', email: 'dana@example.com' }), members)?.athlete.id).toBe('m2');
  });

  it('offers nobody when two members are equally likely', () => {
    const twins = [athlete({ id: 'x', name: 'Avi Barak' }), athlete({ id: 'y', name: 'Avi Barak' })];
    expect(clubMatchFor(candidate({ name: 'אבי ברק' }), twins)).toBeNull();
  });

  it('never offers a member already linked to another card', () => {
    expect(clubMatchFor(candidate({ id: 'c1', name: 'אבי ברק' }), members, { takenBy: { m1: 'c2' } })).toBeNull();
  });

  it('never offers an account the form opened', () => {
    const pending = [athlete({ id: 'p', name: 'Avi Barak', onboardingStatus: 'academy_pending' })];
    expect(clubMatchFor(candidate({ name: 'אבי ברק' }), pending)).toBeNull();
    expect(isFormMadeAccount(pending[0])).toBe(true);
    expect(isFormMadeAccount(members[0])).toBe(false);
  });
});
