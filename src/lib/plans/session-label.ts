import type { ParsedWorkout } from '@/lib/ai/types';

/**
 * How a day's session should be labelled when the day holds more than one.
 *
 * `null` for an ordinary single-session day — the label is noise there, the day
 * name already says everything. Only the discriminator lives here: the two
 * places that render it (the week grid and the day card) each own their own
 * `useTranslations` namespace, and next-intl types the key, so handing a raw
 * string key across a helper boundary buys nothing.
 */
export function sessionKind(workout: ParsedWorkout): 'morning' | 'evening' | 'part' | null {
  if ((workout.partCount ?? 1) <= 1) return null;
  if (workout.partKind === 'morning') return 'morning';
  if (workout.partKind === 'evening') return 'evening';
  return 'part';
}
