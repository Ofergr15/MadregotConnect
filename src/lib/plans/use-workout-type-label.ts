'use client';

import { useTranslations } from 'next-intl';

/**
 * The name of a workout type, in the reader's language.
 *
 * This replaced `WORKOUT_TYPE_LABELS`, a hardcoded English map that lived beside
 * the type COLOURS in `workout-parsing.ts`. The colours belong there — they are
 * design tokens with no language — but the labels put "Tempo", "Long Run" and
 * "Intervals" on three Hebrew screens: the dashboard hero's type chip, the
 * profile's upcoming-workout card and the sync editor's plan-match line. It read
 * as a missing translation and it was worse than that: the strings were never in
 * the message files at all, so no locale switch could reach them.
 *
 * The keys they needed already existed. `activities.runType_*` covers all seven
 * plan types (easy, tempo, intervals, long_run, fartlek, progressive, rest) in
 * both locales, and is the same set `DayByDayReview`, `ActivityFeed` and
 * `NextSessionCard` have always used — so the hero chip and the activity row
 * below it now agree about what a session is called, which they did not.
 *
 * Falls back to the raw slug rather than throwing: `type` comes off stored plan
 * data, and a plan parsed before a type existed must still render a card.
 */
export function useWorkoutTypeLabel() {
  const t = useTranslations('activities');
  return (type: string | null | undefined): string => {
    if (!type) return '';
    const key = `runType_${type}` as 'runType_easy';
    return t.has(key) ? t(key) : type;
  };
}
