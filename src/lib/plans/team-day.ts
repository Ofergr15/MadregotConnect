import { getPlanWeekStart, israelDateAnchor, toISODate } from '@/lib/utils';

/**
 * Which team session the app is currently asking about.
 *
 * Attendance is a DAY-BEFORE flow (matching the Mon 08:00 + Mon 18:00 pushes for a
 * Tuesday workout): the evening before a team day it asks "coming tomorrow?", and on
 * the team day itself it is still the session in question. Two screens have to agree
 * on the answer — the athlete's RSVP card on /dashboard and the coach's roster on the
 * control room — because they are the two halves of one question, and a roster naming
 * Tuesday beside a card asking about Friday is worse than either alone.
 *
 * Israel-anchored, and that is the whole reason it is a function rather than
 * `new Date().getDay()`: `getPlanWeekStart` reads local date parts, so a raw browser
 * date files the answer under the wrong week between midnight and 03:00 — and on a
 * Sunday that is the whole previous week.
 */
export interface TeamDayTarget {
  /** The session's own date, Israel-anchored. */
  date: Date;
  /** 0 = Sunday, matching `dayOfWeek` on a plan day. */
  dow: number;
  /** True when the session is tomorrow — the "coming tomorrow?" copy. */
  dayBefore: boolean;
  /** The plan week the session belongs to, derived from its own date (Sat→Sun boundary). */
  weekStart: string;
  /** `YYYY-MM-DD` of the session. */
  dateKey: string;
}

/**
 * The team session today or tomorrow, or null on the days between.
 *
 * `teamDays` is admin-editable (0=Sun..6=Sat, `/api/reminder-config`), so this takes
 * it rather than assuming the club's Tuesday/Friday.
 */
export function teamDayTarget(teamDays: number[], now: Date = new Date()): TeamDayTarget | null {
  const today = israelDateAnchor(now);
  if (teamDays.includes(today.getDay())) return target(today, false);

  const tomorrow = israelDateAnchor(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (teamDays.includes(tomorrow.getDay())) return target(tomorrow, true);

  return null;
}

function target(date: Date, dayBefore: boolean): TeamDayTarget {
  return {
    date,
    dow: date.getDay(),
    dayBefore,
    weekStart: getPlanWeekStart(date),
    dateKey: toISODate(date),
  };
}
