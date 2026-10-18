/**
 * The name a run shows under, on the feed card and the run page.
 *
 * The watch's automatic names reached the club verbatim — "Running", "Morning Run",
 * "Tel Aviv Running" — English titles on a Hebrew screen, and a feed where half the
 * cards were called "Running". `localizeDefaultName` already translated them, but
 * only on the share card. Here it runs everywhere, and the bare sport name ("Running"
 * / "ריצה"), which says nothing a running club's feed doesn't, becomes the time of
 * day instead — Strava's "Morning Run". A name the athlete typed is never touched.
 */

import { activityLocalHour } from '@/lib/utils';
import { isDefaultName, localizeDefaultName } from '@/lib/share/default-name';

type Lang = 'he' | 'en';

const TIME_OF_DAY: Record<Lang, [number, string][]> = {
  he: [[5, 'ריצת לילה'], [11, 'ריצת בוקר'], [14, 'ריצת צהריים'], [18, 'ריצת אחר הצהריים'], [21, 'ריצת ערב'], [24, 'ריצת לילה']],
  en: [[5, 'Night Run'], [11, 'Morning Run'], [14, 'Lunch Run'], [18, 'Afternoon Run'], [21, 'Evening Run'], [24, 'Night Run']],
};

export function timeOfDayRunName(startTime: string, lang: Lang): string {
  const hour = activityLocalHour(startTime);
  return TIME_OF_DAY[lang].find(([until]) => hour < until)![1];
}

const BARE_SPORT = new Set(['running', 'run', 'ריצה']);

/**
 * `qualityName`: the coach's name for the day's quality session, when this run is it
 * (lib/activities/quality-name.ts). It replaces the watch's automatic name, never one the
 * runner typed.
 */
export function displayRunName(name: string | null | undefined, startTime: string, locale: string, qualityName?: string | null): string {
  const lang: Lang = locale === 'en' ? 'en' : 'he';
  const trimmed = (name || '').trim();
  if (qualityName && (!trimmed || BARE_SPORT.has(trimmed.toLowerCase()) || isDefaultName(trimmed))) return qualityName;
  if (!trimmed || BARE_SPORT.has(trimmed.toLowerCase())) return timeOfDayRunName(startTime, lang);
  return localizeDefaultName(trimmed, lang);
}
