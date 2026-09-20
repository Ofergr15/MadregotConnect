import { addDaysToDateStr } from '@/lib/utils';

/**
 * When the weekly summary sits at the top of the feed: Saturday 18:00 through
 * Sunday 10:00, Israel time.
 *
 * It opens on the same tick as the push (`weekday === 6 && hour === 18` in
 * /api/cron/tick) so the notification and the feed cannot show the week at
 * different moments, and it closes Sunday morning because by then the new week has
 * started and last week's totals are history the feed should not be leading with.
 *
 * The window straddles midnight, which is the only reason this is a module and not
 * an inline comparison: on Sunday morning the report being shown is still
 * SATURDAY's, so the dismissal has to be keyed to the Saturday — otherwise closing
 * it at 23:00 lets it come back at 08:00 the next morning.
 */

export const WEEK_SUMMARY_OPEN_HOUR = 18;
export const WEEK_SUMMARY_CLOSE_HOUR = 10;

/** @param weekday 0 = Sunday, matching `israelNow().weekday` */
export function isWeekSummaryWindow({ weekday, hour }: { weekday: number; hour: number }): boolean {
  if (weekday === 6) return hour >= WEEK_SUMMARY_OPEN_HOUR;
  if (weekday === 0) return hour < WEEK_SUMMARY_CLOSE_HOUR;
  return false;
}

/**
 * The Saturday this showing belongs to, as a YYYY-MM-DD — the dismissal key, and
 * also the report's own `to` date.
 *
 * @param todayKey Israel's date now
 * @param weekday  Israel's weekday now
 */
export function weekSummaryAnchor(todayKey: string, weekday: number): string {
  return weekday === 0 ? addDaysToDateStr(todayKey, -1) : todayKey;
}

/** One key per Saturday, so a dismissal never carries into the following week. */
export function weekSummaryDismissKey(anchor: string): string {
  return `mc:weekSummaryDismissed:${anchor}`;
}
