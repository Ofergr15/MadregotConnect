import type { ShareI18n } from '@/lib/feed/share-image';
import type { WeekCardLang } from '@/lib/reports/week-share';

/**
 * THE WORKOUT CARD'S OWN LANGUAGE, which is not the app's.
 *
 * The weekly card has had this since it shipped and the workout card never did —
 * it read its labels from `useTranslations`, which only ever resolves the ACTIVE
 * locale, so the card a Hebrew athlete posted was always Hebrew. That is wrong for
 * the same reason it was wrong on the weekly card: the app is Hebrew for everyone
 * here, and a story's audience often is not.
 *
 * A plain table rather than a next-intl lookup, for exactly the reason given above
 * `WEEK_CARD_TEXT` — reading the other catalogue at runtime would mean shipping
 * both message files to the browser to print twelve short strings. The two tables
 * are deliberately side by side in shape so one sheet can drive both cards.
 */
export type ShareCardLang = WeekCardLang;

export const SHARE_CARD_LANGS: ShareCardLang[] = ['he', 'en'];

export const WORKOUT_CARD_TEXT: Record<ShareCardLang, ShareI18n> = {
  he: {
    km: 'ק״מ',
    perKm: '/ק״מ',
    pace: 'קצב ממוצע',
    time: 'זמן',
    hr: 'דופק',
    start: 'התחלה',
    distance: 'מרחק',
    elevation: 'טיפוס',
    calories: 'קלוריות',
    metres: 'מ׳',
    hoursShort: 'ש׳',
    minutesShort: 'דק׳',
  },
  en: {
    km: 'km',
    perKm: '/km',
    pace: 'Avg pace',
    time: 'Time',
    hr: 'HR',
    start: 'Started',
    distance: 'Distance',
    elevation: 'Elev gain',
    calories: 'Calories',
    metres: 'm',
    hoursShort: 'h',
    minutesShort: 'min',
  },
};
