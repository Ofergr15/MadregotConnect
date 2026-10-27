import { israelNow, israelToday } from '@/lib/utils';

// "Once a quality session starts, take the poll down — from the feed and everywhere, it is
// no longer relevant" (Ofer 10-27). The "מגיעים? ועם איזו דבוקה?" question is asked until the
// session's start (the club's workoutHour, 05:00), and then nowhere: not the feed card, not
// the inbox's buttons, not a push's deep link.

/** The team day's date from a plan week (Sunday) and a weekday. */
export function sessionDate(weekStart: string, day: number): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((day - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** Is it still before that session's start? Unknown hour → 05:00, the club's. */
export function rsvpOpen(date: string, workoutHour: number | null | undefined, now = new Date()): boolean {
  const today = israelToday(now);
  if (date > today) return true;
  if (date < today) return false;
  const h = typeof workoutHour === 'number' ? workoutHour : 5;
  const { hour, minute } = israelNow(now);
  return hour + minute / 60 < h;
}
