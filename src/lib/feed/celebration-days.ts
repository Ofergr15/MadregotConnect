import { addDaysToDateStr } from '@/lib/utils';

// How long a celebration stays on the circles (mockup celebrations-control, 3-5).
// `until` is the last Israel day, inclusive: one day is the day itself.

/** The automatic birthday post's default (the "חגיגות" screen's setting). */
export const BIRTHDAY_DAYS_KEY = 'celebration-birthday-days';
export const DAY_CHOICES = [1, 2, 3, 7] as const;

export function readBirthdayDays(raw: string | null | undefined): number {
  const n = Number(raw);
  return (DAY_CHOICES as readonly number[]).includes(n) ? n : 1;
}

export function untilAfter(day: string, days: number): string {
  return addDaysToDateStr(day, Math.max(1, Math.round(days)) - 1);
}
