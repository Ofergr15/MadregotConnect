/**
 * Which language an athlete's notifications are written in.
 *
 * The app's UI language already exists and is chosen per BROWSER: next-intl
 * reads it from the `NEXT_LOCALE` cookie (src/i18n/locale.ts, set by
 * LocaleSwitcher and seeded from Accept-Language in proxy.ts). That is exactly
 * the wrong place for notifications to look, and not by a little: almost every
 * push in this app is sent from a cron job or a Garmin sync — there is no
 * request from the athlete in flight, so there is no cookie to read. The
 * choice has to be persisted per athlete, server-side, or a notification
 * cannot know what language to be in.
 *
 * It is stored in `athletes.notification_prefs.language` rather than in a new
 * column, for two reasons: that JSONB is already loaded on the send path (see
 * filterByCategory / prefsByAthlete in push.ts), so reading it costs nothing
 * extra; and it needs no migration, which in this project means no waiting on
 * a hand-applied SQL step before the feature works.
 */
export const NOTIFICATION_LOCALES = ['he', 'en'] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

/**
 * Hebrew, matching getLocaleFromCookie's fallback and the club's actual
 * membership. Anything unrecognised lands here rather than throwing: a
 * notification going out in the wrong language is a small annoyance, a
 * notification not going out at all is the bug this whole subsystem exists to
 * avoid.
 */
export const DEFAULT_NOTIFICATION_LOCALE: NotificationLocale = 'he';

/**
 * Exactly 'he' or 'en' — the strict check, for validating what a client sends
 * before it is written. Deliberately not tolerant: `String(['en'])` is `'en'`,
 * so a lenient guard here would accept an array and then store something the
 * guard itself hadn't really approved.
 */
export function isSupportedNotificationLocale(value: unknown): value is NotificationLocale {
  return typeof value === 'string' && (NOTIFICATION_LOCALES as readonly string[]).includes(value);
}

/**
 * The tolerant counterpart, for READING a value back out of the database.
 * Accepts the regional and cased forms a browser produces ('en-US', 'EN'),
 * because proxy.ts seeds the UI locale from Accept-Language and a client could
 * echo one of those into the preference. Anything else — including a non-string
 * — resolves to the default instead of throwing.
 */
export function normalizeNotificationLocale(value: unknown): NotificationLocale {
  if (typeof value !== 'string') return DEFAULT_NOTIFICATION_LOCALE;
  const v = value.toLowerCase().slice(0, 2);
  return (NOTIFICATION_LOCALES as readonly string[]).includes(v)
    ? (v as NotificationLocale)
    : DEFAULT_NOTIFICATION_LOCALE;
}

/**
 * The athlete's notification language as saved in notification_prefs.
 *
 * `language` shares that JSON object with the category booleans, so it is
 * deliberately read by name and normalized — the object is also written by
 * older clients that knew nothing about it.
 */
export function localeFromPrefs(
  prefs: Record<string, unknown> | null | undefined,
): NotificationLocale {
  return normalizeNotificationLocale(prefs?.language);
}
