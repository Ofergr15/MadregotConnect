import { describe, it, expect } from 'vitest';
import {
  buildUpcoming,
  daysBetween,
  isEmptyUpcoming,
  nextBirthday,
} from '@/lib/events/upcoming';

/**
 * The upcoming-events lanes.
 *
 * Dates are the whole risk here: every bug this card can have is an off-by-one
 * day (an event that vanishes on its own morning, a birthday greeted a day late,
 * a multi-day camp dropped on day two), and all of them are reachable with
 * nothing but a fixed "today".
 */

const TODAY = '2026-09-18';

const race = (over = {}) => ({ id: 'r1', kind: 'race', name: 'Ruler Race', date: '2026-10-09', ...over });
const social = (over = {}) => ({ id: 'c1', kind: 'social', name: 'Club dinner', date: '2026-09-20', ...over });

describe('daysBetween', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween(TODAY, '2026-09-18')).toBe(0);
    expect(daysBetween(TODAY, '2026-09-19')).toBe(1);
    expect(daysBetween(TODAY, '2026-09-17')).toBe(-1);
  });

  /** Israel moves its clock in late October; a 23/25-hour day must still be one day. */
  it('is unaffected by a DST boundary', () => {
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
  });
});

describe('nextBirthday', () => {
  it('takes this year when the day is still ahead', () => {
    expect(nextBirthday('1993-11-17', TODAY)).toBe('2026-11-17');
  });

  it('rolls to next year once the day has passed', () => {
    expect(nextBirthday('1995-07-15', TODAY)).toBe('2027-07-15');
  });

  /** The birthday IS today — greeting it tomorrow would be the whole point missed. */
  it('returns today when the birthday is today', () => {
    expect(nextBirthday('1990-09-18', TODAY)).toBe('2026-09-18');
  });

  it('moves a Feb 29 birthday to Mar 1 in a common year, never earlier', () => {
    expect(nextBirthday('1996-02-29', '2027-01-05')).toBe('2027-03-01');
    expect(nextBirthday('1996-02-29', '2028-01-05')).toBe('2028-02-29');
  });

  it('ignores an unparseable stored date rather than throwing', () => {
    expect(nextBirthday('not-a-date', TODAY)).toBeNull();
  });

  /** Postgres may hand back a full timestamp; only the day part matters. */
  it('accepts a timestamp form', () => {
    expect(nextBirthday('1993-11-17T00:00:00+00:00', TODAY)).toBe('2026-11-17');
  });
});

describe('buildUpcoming', () => {
  const base = { events: [race(), social()], athletes: [], today: TODAY };

  it('separates races from every other kind of club event', () => {
    const b = buildUpcoming(base);
    expect(b.races.map(e => e.id)).toEqual(['r1']);
    expect(b.club.map(e => e.id)).toEqual(['c1']);
  });

  it('reports how far away each event is, never negative', () => {
    const b = buildUpcoming({ ...base, events: [social({ date: TODAY })] });
    expect(b.club[0].daysAway).toBe(0);
  });

  it('drops events whose day has passed', () => {
    const b = buildUpcoming({ ...base, events: [race({ date: '2026-09-17' })] });
    expect(b.races).toEqual([]);
  });

  /** A three-day camp is still on during day two — it must not vanish overnight. */
  it('keeps a multi-day event until its last day', () => {
    const camp = { id: 'k1', kind: 'camp', name: 'Camp', date: '2026-09-16', end_date: '2026-09-19' };
    expect(buildUpcoming({ ...base, events: [camp] }).club.map(e => e.id)).toEqual(['k1']);
    expect(buildUpcoming({ ...base, events: [camp], today: '2026-09-20' }).club).toEqual([]);
  });

  it('orders each lane by date and caps it', () => {
    const events = [
      race({ id: 'r3', date: '2026-12-06' }),
      race({ id: 'r1', date: '2026-10-09' }),
      race({ id: 'r4', date: '2027-01-01' }),
      race({ id: 'r2', date: '2026-10-30' }),
    ];
    expect(buildUpcoming({ ...base, events }).races.map(e => e.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('lists the soonest birthdays, without a year', () => {
    const athletes = [
      { id: 'a1', name: 'Tal', birth_date: '1993-11-17', status: 'active' },
      { id: 'a2', name: 'Roy', birth_date: '1998-10-14', status: 'active' },
    ];
    const b = buildUpcoming({ ...base, athletes });
    expect(b.birthdays.map(x => [x.name, x.date, x.daysAway])).toEqual([['Roy', '2026-10-14', 26]]);
    expect(JSON.stringify(b.birthdays)).not.toContain('1998');
  });

  it('skips athletes with no birth date, no name, or no longer active', () => {
    const athletes = [
      { id: 'a1', name: 'No date', birth_date: null, status: 'active' },
      { id: 'a2', name: null, birth_date: '1990-09-25', status: 'active' },
      { id: 'a3', name: 'Left the club', birth_date: '1990-09-25', status: 'inactive' },
    ];
    expect(buildUpcoming({ ...base, athletes }).birthdays).toEqual([]);
  });

  it('holds birthdays to a nearer horizon than races', () => {
    const athletes = [{ id: 'a1', name: 'Far', birth_date: '1990-12-01', status: 'active' }];
    expect(buildUpcoming({ ...base, athletes }).birthdays).toEqual([]);
    expect(buildUpcoming({ ...base, athletes, birthdayWindowDays: 120 }).birthdays).toHaveLength(1);
  });
});

describe('isEmptyUpcoming', () => {
  it('is true only when every lane is empty', () => {
    expect(isEmptyUpcoming(buildUpcoming({ events: [], athletes: [], today: TODAY }))).toBe(true);
    expect(isEmptyUpcoming(buildUpcoming({ events: [race()], athletes: [], today: TODAY }))).toBe(false);
  });
});
