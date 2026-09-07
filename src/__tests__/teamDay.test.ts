import { describe, expect, it } from 'vitest';
import { teamDayTarget } from '@/lib/plans/team-day';

/**
 * Which team session the app is asking about. Two screens read this — the athlete's
 * RSVP card on /dashboard and the coach's roster in the control room — and they used
 * to compute it separately, one of them inline in a 1300-line page. A roster naming
 * Tuesday beside a card asking about Friday is worse than either alone, which is why
 * it is one function; these are the answers both of them now depend on.
 *
 * The club's own days are Tue + Fri (`[2, 5]`, the `/api/reminder-config` default),
 * so that is the pair most of these use.
 */

const CLUB = [2, 5];

// Israel wall-clock instants written as offsets rather than Z, so the intent of each
// fixture ("Monday evening") survives DST.
const at = (iso: string) => new Date(iso);

describe('teamDayTarget', () => {
  it('names today when today is a team day', () => {
    const target = teamDayTarget(CLUB, at('2026-09-08T17:00:00+03:00')); // Tue
    expect(target).not.toBeNull();
    expect(target!.dow).toBe(2);
    expect(target!.dayBefore).toBe(false);
    expect(target!.dateKey).toBe('2026-09-08');
    expect(target!.weekStart).toBe('2026-09-06'); // the Sunday it belongs to
  });

  it('names tomorrow the day before, which is when the pushes go out', () => {
    // RSVP is a day-before flow: the Mon 08:00 + Mon 18:00 reminders are for
    // Tuesday's session, so Monday has to answer "coming tomorrow?".
    const target = teamDayTarget(CLUB, at('2026-09-07T18:30:00+03:00')); // Mon
    expect(target!.dow).toBe(2);
    expect(target!.dayBefore).toBe(true);
    expect(target!.dateKey).toBe('2026-09-08');
  });

  it('has nothing to say on the days between', () => {
    expect(teamDayTarget(CLUB, at('2026-09-09T18:00:00+03:00'))).toBeNull(); // Wed
    expect(teamDayTarget(CLUB, at('2026-09-12T09:00:00+03:00'))).toBeNull(); // Sat
  });

  it('prefers today over tomorrow when both are team days', () => {
    // Thu + Fri, and it is Thursday: the session in progress wins. Otherwise a club
    // with back-to-back days would spend every one of them asking about the next.
    const target = teamDayTarget([4, 5], at('2026-09-10T17:00:00+03:00')); // Thu
    expect(target!.dateKey).toBe('2026-09-10');
    expect(target!.dayBefore).toBe(false);
  });

  it('reads the days it is given, not the club default', () => {
    // `teamDays` is admin-editable in the reminder config, which is the whole reason
    // it is a parameter — a Sunday/Wednesday club must not get Tue/Fri answers.
    // Monday, for a Sun/Wed club: neither today nor tomorrow, where the same instant
    // is the club's own day-before Tuesday.
    expect(teamDayTarget([0, 3], at('2026-09-07T17:00:00+03:00'))).toBeNull();
    expect(teamDayTarget(CLUB, at('2026-09-07T17:00:00+03:00'))!.dow).toBe(2);
    expect(teamDayTarget([0, 3], at('2026-09-09T17:00:00+03:00'))!.dow).toBe(3); // Wed
  });

  it('derives the week from the TARGET date, across the Sat→Sun boundary', () => {
    // The reason `weekStart` is on the target at all. A Sunday session asked about on
    // Saturday evening belongs to the week that starts THE NEXT DAY — file the answer
    // under the asker's week and the coach's roster reads an empty Sunday while the
    // athlete's yes sits in last week's plan.
    const target = teamDayTarget([0], at('2026-09-12T20:00:00+03:00')); // Sat, for Sun
    expect(target!.dayBefore).toBe(true);
    expect(target!.dateKey).toBe('2026-09-13');
    expect(target!.weekStart).toBe('2026-09-13');
  });

  it('is Israel-anchored, so the answer does not change at UTC midnight', () => {
    // 00:30 Tuesday in Israel is still Monday 21:30 in UTC. A raw browser/server date
    // there answers "Monday" — the day-before card for a session already today — and
    // on a Sunday the same slip moves the whole week (see israelTime.test.ts).
    const justAfterMidnightTuesday = new Date('2026-09-07T21:30:00Z');
    const target = teamDayTarget(CLUB, justAfterMidnightTuesday);
    expect(target!.dateKey).toBe('2026-09-08');
    expect(target!.dayBefore).toBe(false);
    expect(target!.weekStart).toBe('2026-09-06');
  });

  it('returns a date that agrees with its own dow and dateKey', () => {
    // `date` is what callers hand to getPlanWeekStart/planDayKey, so the three must
    // never disagree — a plan day is matched by DATE and rendered by DAY.
    for (const iso of ['2026-09-07T18:00:00+03:00', '2026-09-11T06:00:00+03:00']) {
      const target = teamDayTarget(CLUB, at(iso))!;
      expect(target.date.getDay()).toBe(target.dow);
      expect(target.dateKey.endsWith(String(target.date.getDate()).padStart(2, '0'))).toBe(true);
    }
  });
});
