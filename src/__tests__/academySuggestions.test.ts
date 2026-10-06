import { describe, expect, it } from 'vitest';
import {
  buildSuggestions, dismissSuggestion, freeSeats, isHidden, nextSuggestion, recommendCoach, snoozeUntilTomorrow,
} from '@/lib/academy/suggestions';

/**
 * The academy home's smart suggestion: one at a time, the pairing first, and
 * snooze/dismiss that actually stick.
 */

const coach = (coachId: string, coachName: string, trainees: number) => ({ coachId, coachName, trainees });
const member = (athleteId: string, name: string, o: Partial<{ academyCoachId: string | null; academyJoinedOn: string | null; daysSinceActivity: number | null; approved: boolean }> = {}) => ({
  athleteId, name, approved: true, academyCoachId: 'dana', academyJoinedOn: '2026-01-01', daysSinceActivity: 1, ...o,
});
const today = '2026-10-06';

describe('capacity', () => {
  it('counts free seats and never goes below zero', () => {
    expect(freeSeats(coach('a', 'A', 6), 8)).toBe(2);
    expect(freeSeats(coach('a', 'A', 10), 8)).toBe(0);
  });

  it('recommends the coach with the most room who can take everybody', () => {
    const list = [coach('dana', 'Dana Levi', 6), coach('guy', 'Guy Ziv', 7), coach('avi', 'Avi Peretz', 0)];
    expect(recommendCoach(list, 8, 2)?.coachId).toBe('avi');
    expect(recommendCoach([coach('dana', 'Dana', 7), coach('guy', 'Guy', 8)], 8, 2)?.coachId).toBe('dana');
    expect(recommendCoach([coach('guy', 'Guy', 8)], 8)).toBeNull();
    expect(recommendCoach([{ coachId: null, coachName: null, trainees: 0 }], 8)).toBeNull();
  });
});

describe('buildSuggestions', () => {
  const coaches = [coach('dana', 'Dana Levi', 6), coach('guy', 'Guy Ziv', 6), coach('avi', 'Avi Peretz', 0)];

  it('suggests pairing the two longest-unpaired with the freest coach', () => {
    const [s] = buildSuggestions({
      members: [
        member('t1', 'Raz Kedem', { academyCoachId: null, academyJoinedOn: '2026-10-02' }),
        member('t2', 'Adi Nir', { academyCoachId: null, academyJoinedOn: '2026-09-30' }),
        member('t3', 'Later One', { academyCoachId: null, academyJoinedOn: '2026-10-05' }),
        member('t4', 'Michal Raz'),
      ],
      coaches, capacity: 8, isManager: true, today,
    });
    expect(s.kind).toBe('pair');
    expect(s.title).toBe('לשבץ את Adi ו־Raz אצל Avi?');
    expect(s.primary).toBe('לשבץ שניהם');
    expect(s.sub).toBe('בלי מאמן 6 ימים · Avi פנוי');
    expect(s.coachId).toBe('avi');
    expect(s.key).toBe('pair:t1,t2');
  });

  it('pairs one when the coach has one seat', () => {
    const [s] = buildSuggestions({
      members: [member('t1', 'Raz', { academyCoachId: null }), member('t2', 'Adi', { academyCoachId: null })],
      coaches: [coach('dana', 'Dana', 7)], capacity: 8, isManager: true, today,
    });
    expect(s.people.map((p) => p.id)).toHaveLength(1);
    expect(s.primary).toBe('לשבץ');
  });

  it('never suggests pairing to a coach, and nothing about full coaches', () => {
    const list = buildSuggestions({
      members: [member('t1', 'Raz', { academyCoachId: null })], coaches, capacity: 8, isManager: false, today,
    });
    expect(list.find((s) => s.kind === 'pair')).toBeUndefined();
    const full = buildSuggestions({
      members: [member('t1', 'Raz', { academyCoachId: null })], coaches: [coach('dana', 'Dana', 8)], capacity: 8, isManager: true, today,
    });
    expect(full.find((s) => s.kind === 'pair')).toBeUndefined();
  });

  it('then the quietest trainee, then the watches', () => {
    const list = buildSuggestions({
      members: [member('a', 'Noa Barak', { daysSinceActivity: 9 }), member('b', 'Yoav', { daysSinceActivity: 12 }), member('c', 'Fine', { daysSinceActivity: 2 })],
      coaches, capacity: 8, isManager: true, today,
      dispatch: [{ athleteId: 'x', name: 'Tom Haim' }, { athleteId: 'x', name: 'Tom Haim' }],
    });
    expect(list.map((s) => s.kind)).toEqual(['write', 'write', 'resend']);
    expect(list[0]).toMatchObject({ title: 'לכתוב ל־Yoav?', sub: 'לא רץ 12 ימים', key: 'write:b' });
    expect(list[2]).toMatchObject({ title: 'האימון לא הגיע לשעון של Tom', primary: 'לשלוח שוב' });
  });
});

describe('snooze and dismiss', () => {
  const list = buildSuggestions({
    members: [member('a', 'Noa', { daysSinceActivity: 9 }), member('b', 'Yoav', { daysSinceActivity: 12 })],
    coaches: [], capacity: 8, isManager: true, today,
  });
  const now = Date.parse('2026-10-06T10:00:00.000Z');

  it('skips a snoozed suggestion until tomorrow morning, then brings it back', () => {
    const store = snoozeUntilTomorrow({}, 'write:b', now);
    expect(store['write:b'].until).toBe(Date.parse('2026-10-07T06:00:00.000Z'));
    expect(nextSuggestion(list, store, now)?.key).toBe('write:a');
    expect(nextSuggestion(list, store, Date.parse('2026-10-07T07:00:00.000Z'))?.key).toBe('write:b');
  });

  it('snoozes to the next Israel day even late at night UTC', () => {
    // 22:30 UTC on the 6th is already 01:30 on the 7th in Israel.
    const store = snoozeUntilTomorrow({}, 'k', Date.parse('2026-10-06T22:30:00.000Z'));
    expect(store.k.until).toBe(Date.parse('2026-10-08T06:00:00.000Z'));
  });

  it('never shows a dismissed one again', () => {
    const store = dismissSuggestion(dismissSuggestion({}, 'write:b'), 'write:a');
    expect(isHidden(store, 'write:a', now + 1e12)).toBe(true);
    expect(nextSuggestion(list, store, now)).toBeNull();
  });
});
