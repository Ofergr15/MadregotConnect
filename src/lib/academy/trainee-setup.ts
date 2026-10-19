/**
 * The coach's "טופס התאמה" for a trainee (academy-onboarding/who-fills-what.html): what the
 * coach decides and knows, not the trainee — the coaching type and the academy band — next to
 * the characterization (goal, days, km…), which already lives on the trainee's funnel card.
 */

/** The two kinds of coaching the academy sells; the same words the full form offers a newcomer. */
export const COACHING_TYPES = [
  'שילוב של תכנית און ליין עם מפגשים פיזיים',
  'רק תכנית אימון און ליין ומעקב',
] as const;
export const isCoachingType = (v: unknown): v is (typeof COACHING_TYPES)[number] =>
  typeof v === 'string' && (COACHING_TYPES as readonly string[]).includes(v);

export type SetupMissing = 'coachingType' | 'band' | 'goal' | 'days';

/** What the coach still has to fill in, in the order the form asks it. */
export function setupMissing(p: { coachingType: string | null; bandId: string | null; goalType: string | null; availableDays: number[] }): SetupMissing[] {
  const out: SetupMissing[] = [];
  if (!p.coachingType) out.push('coachingType');
  if (!p.bandId) out.push('band');
  if (!p.goalType) out.push('goal');
  if (!p.availableDays.length) out.push('days');
  return out;
}

export const MISSING_LABEL: Record<SetupMissing, string> = {
  coachingType: 'סוג הליווי', band: 'דבוקה', goal: 'מטרה', days: 'ימי אימון',
};
