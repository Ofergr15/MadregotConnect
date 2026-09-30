import { addDaysToDateStr } from '@/lib/utils';

/**
 * A MEMBER'S OWN PACE-GROUP CHANGE, WAITING FOR SATURDAY (feedback #96).
 *
 * "Let the athletes change their pace group, from their personal profile, with a
 * notice that the change only takes effect on Saturday, because the plans are sent
 * in advance." A group decides whose week goes to the watch, and the current
 * week's workouts are already on it, so the move is written as pending
 * (migration 125: `pending_group_id`, `pending_group_from`) and the tick applies it
 * once the day comes.
 */

/**
 * The Saturday a change asked for on `today` (Israel, YYYY-MM-DD) takes effect:
 * the next one strictly after today. Asked for on a Saturday, it is the following
 * one, because by Saturday the next week has already been sent.
 */
export function groupChangeDate(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDaysToDateStr(today, 6 - weekday || 7);
}

/** Whether a pending change dated `from` is due on `today`. */
export function groupChangeDue(from: string | null | undefined, today: string): boolean {
  return !!from && from <= today;
}
