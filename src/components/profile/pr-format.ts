import { formatTime } from '@/lib/academy/benchmark';
import { teammateHref } from '@/lib/athletes/profile-link';
import { agoUnit, daysBetween } from '@/lib/prs/record-history';

/**
 * Small formatters shared by the PRs tab and the record screen.
 *
 * Every date here is read off the STRING, never through `new Date()` getters:
 * an activity's start_time is the watch's local wall clock stored as UTC
 * (Convention A, lib/utils.ts), and a stated record's date is a bare YYYY-MM-DD.
 */

/** Seconds per km for a bucket time, as "3:38". */
export function prPace(seconds: number, meters: number): string {
  return formatTime(Math.round(seconds / (meters / 1000)));
}

/** "23.9.26" — the run line on the tab. */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
}

/** "23 בספטמבר 2026" / "23 September 2026" under the hero time. */
export function longDay(iso: string, locale: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A short month name ("ספט׳"), for the timeline and the history list. */
export function shortMonth(month: number, locale: string): string {
  return new Date(Date.UTC(2000, month - 1, 15)).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
}

/** "ספט׳ 26" — month and two-digit year. */
export function monthYear(iso: string, locale: string): string {
  return `${shortMonth(Number(iso.slice(5, 7)), locale)} ${iso.slice(2, 4)}`;
}

/** The ICU key + count for "… ago", from a record's date to today (Israel). */
export function agoMessage(iso: string, today: string): { key: 'agoDays' | 'agoWeeks' | 'agoMonths' | 'agoYears'; n: number } {
  const { unit, n } = agoUnit(daysBetween(iso, today));
  const key = unit === 'days' ? 'agoDays' : unit === 'weeks' ? 'agoWeeks' : unit === 'months' ? 'agoMonths' : 'agoYears';
  return { key, n };
}

/** The bucket label the mockups use: 5K · 10K · חצי מרתון · מרתון. */
export const PR_DIST_KEYS: Record<string, 'prDist_5k' | 'prDist_10k' | 'prDist_hm' | 'prDist_fm'> = {
  '5k': 'prDist_5k',
  '10k': 'prDist_10k',
  hm: 'prDist_hm',
  fm: 'prDist_fm',
};

/** Where a record's own screen lives — any member's, like their profile. */
export function recordHref(athleteId: string, bucketKey: string): string | null {
  const profile = teammateHref(athleteId);
  return profile ? `${profile}/records/${encodeURIComponent(bucketKey)}` : null;
}

/**
 * Coming back from a record screen should land on the PRs tab, not on Overview —
 * the tab is component state, so the link leaves a one-shot note behind it.
 */
export const PR_RETURN_KEY = 'profile_return_prs';
