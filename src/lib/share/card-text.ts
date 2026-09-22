import type { ShareI18n } from '@/lib/feed/share-image';
import type { WeekCardLang } from '@/lib/reports/week-share';
import type { ExecutionDirection } from '@/lib/plan-execution/verdict';

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
    splits: 'ק״מ אחרי ק״מ',
    fastest: 'הגבוה = המהיר',
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
    splits: 'Kilometre by kilometre',
    fastest: 'tallest = fastest',
  },
};

/**
 * THE VERDICT'S WORDS, in the card's language.
 *
 * A second copy of `execution.dirShort_*` from the two catalogues, and deliberately
 * so — for exactly the reason `WORKOUT_CARD_TEXT` above is a table. The card's
 * language is chosen per share and `useTranslations` only ever resolves the ACTIVE
 * one, so an athlete posting an English card would otherwise get a Hebrew verdict on
 * it: the single most conspicuous string on the card, in the wrong language.
 *
 * The COLOURS are not copied. `DIRECTION_COLOR` in `lib/plan-execution/verdict.ts`
 * stays the one source for those, because three surfaces already render this verdict
 * and a direction that is blue in the app and orange on the card is worse than no
 * colour at all.
 */
export const VERDICT_TEXT: Record<ShareCardLang, Record<ExecutionDirection, string>> = {
  he: {
    on_target: 'בטווח',
    incomplete: 'חסרות חזרות',
    too_fast: 'מהר מהתוכנית',
    too_slow: 'לאט מהתוכנית',
    mixed: 'קצב לא אחיד',
    too_long: 'יותר מהתוכנית',
    too_short: 'פחות מהתוכנית',
    unknown: 'אין נתונים',
  },
  en: {
    on_target: 'On target',
    incomplete: 'Reps missing',
    too_fast: 'Faster than plan',
    too_slow: 'Slower than plan',
    mixed: 'Uneven pace',
    too_long: 'Longer than plan',
    too_short: 'Shorter than plan',
    unknown: 'Not enough data',
  },
};
