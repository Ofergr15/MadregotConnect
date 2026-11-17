// Badges (and the challenges that mint them) are stored bilingually in the DB:
// name_he/name_en, description_he/description_en. Every reader-facing surface
// must pick ONE by locale; the admin lists used to print name_en under the
// Hebrew name, which is how "First 10K" / "100km in September" reached the
// Hebrew settings screen. Falls back to the other language when one is empty.
export function pickLocalized(he: string | null | undefined, en: string | null | undefined, locale: string): string {
  const a = (locale === 'he' ? he : en)?.trim();
  if (a) return a;
  return ((locale === 'he' ? en : he) ?? '').trim();
}

export type BadgeMetric = { kind: 'km' | 'hours' | 'm' | 'workouts'; value: number };

/** The message key (under `badgeManager`) for a metric's "<n> <unit>" label. */
export const METRIC_KEYS: Record<BadgeMetric['kind'], string> = {
  km: 'metricKm',
  hours: 'metricHours',
  m: 'metricMeters',
  workouts: 'metricWorkoutsCount',
};
