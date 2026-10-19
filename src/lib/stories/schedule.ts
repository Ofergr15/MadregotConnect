import { nextBirthday } from '@/lib/events/upcoming';
import { addDays } from './instances';

/**
 * Which occurrence (period) of a story a date belongs to. Pure; every date is an Israel
 * calendar date (YYYY-MM-DD).
 *
 * Birthday: the most recent birthday within `lookbackDays` (so a story postponed or
 * extended past its day is still found), else none. Feb 29 is celebrated on Mar 1 in a
 * common year — that is `nextBirthday`'s own behaviour, kept on purpose.
 * Annual: Dec 31 (settings.annual_date) of this year from that day on, and of last year
 * through January — the story is open until Jan 31.
 */
export function recentBirthday(birthDate: string | null | undefined, today: string, lookbackDays = 31): string | null {
  if (!birthDate) return null;
  const b = nextBirthday(birthDate, addDays(today, -lookbackDays));
  return b && b <= today ? b : null;
}

/** The birthday on or after `today` (the upcoming list). No birth date = none. */
export function upcomingBirthday(birthDate: string | null | undefined, today: string): string | null {
  if (!birthDate) return null;
  return nextBirthday(birthDate, today);
}

export function annualPeriod(today: string, annualDate = '12-31'): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${annualDate}`;
  if (today >= thisYear) return thisYear;
  // The previous occurrence, while still inside its January.
  const last = `${year - 1}-${annualDate}`;
  return today <= `${year}-01-31` ? last : null;
}

/** The next annual occurrence on or after today (the upcoming list / the home card). */
export function nextAnnualPeriod(today: string, annualDate = '12-31'): string {
  const year = Number(today.slice(0, 4));
  const p = `${year}-${annualDate}`;
  return today <= p ? p : `${year + 1}-${annualDate}`;
}

/** היום / מחר / השבוע / later, for grouping the upcoming list. */
export function bucketOf(period: string, today: string): 'today' | 'tomorrow' | 'week' | 'later' | 'past' {
  if (period < today) return 'past';
  if (period === today) return 'today';
  if (period === addDays(today, 1)) return 'tomorrow';
  return period <= addDays(today, 7) ? 'week' : 'later';
}
