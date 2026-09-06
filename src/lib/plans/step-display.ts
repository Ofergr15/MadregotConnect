import type { WorkoutStep } from '@/lib/ai/types';
import { stepPaceTokens } from '@/lib/garmin/pace';
import { durationRangeFromNotes } from '@/lib/workout-duration';

/**
 * How one workout step is put into words — the metric it leads with, and what is
 * left of its note once the things already on the row are taken out of it.
 *
 * This exists because the same three decisions were being made differently in
 * WorkoutPreview (week cards), WeekView's detail sheet and the clipboard text,
 * and all three got them wrong in a way the coach noticed on the same screen:
 *
 *  1. A REST inside a repeat block printed `notes || duration`, so Sunday's
 *     "8 × 15 שנ׳ / 45 שנ׳ הליכה" rendered as "8x 15s" + "הליכה" — the note
 *     REPLACED the 45 seconds instead of qualifying them, and the rest of the
 *     interval simply wasn't on the card.
 *  2. An `open` step printed the word "סבב" (Lap) and dropped its note, so
 *     Wednesday ("70-80 דק׳ ריצת שחרור קלה") and Monday evening ("אופציה ל30-40
 *     דק׳ קל בערב") — whose entire prescription lives in that note — showed a
 *     card with no content on it at all.
 *  3. Notes were printed verbatim next to the pace chip, and in this program
 *     most notes ARE the pace ("4:25", "5:00-5:30"), so the row said the same
 *     number twice.
 *
 * Everything here is pure and unit-tested; the components only choose layout.
 */

/** Unit words, passed in so this stays pure and testable (he: ק״מ / מ׳ / שנ׳ / דק׳). */
export interface StepUnits {
  km: string;
  m: string;
  sec: string;
  min: string;
}

export const LATIN_UNITS: StepUnits = { km: 'km', m: 'm', sec: 's', min: 'min' };

/**
 * A step whose prescription exists only in prose: `durationType: 'open'`, or a
 * distance/time step with no value. Its note is not a footnote — it is the
 * workout, and it must never be replaced by a "Lap" placeholder.
 */
export function isProseStep(step: WorkoutStep): boolean {
  return !(step.durationValue && (step.durationType === 'distance' || step.durationType === 'time'));
}

/** `2 ק״מ` · `300 מ׳` · `45 שנ׳` · `9 דק׳` · `1:30`. Empty for a prose step. */
export function stepMetric(step: WorkoutStep, units: StepUnits): string {
  const value = step.durationValue;
  if (step.durationType === 'distance' && value) {
    return value >= 1000
      ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} ${units.km}`
      : `${value} ${units.m}`;
  }
  if (step.durationType === 'time' && value) {
    // A coach-written RANGE beats the single figure the parser had to choose:
    // Saturday is written "40-50 דק׳" and stored as 2700s, and "45 דק׳" is a
    // decision the athlete never made.
    const fromNotes = durationRangeFromNotes(step.notes);
    if (fromNotes && fromNotes.min !== fromNotes.max) {
      return `${fromNotes.min / 60}–${fromNotes.max / 60} ${units.min}`;
    }
    if (value < 60) return `${value} ${units.sec}`;
    if (value % 60 === 0) return `${value / 60} ${units.min}`;
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  return '';
}

const MINUTES_PHRASE = /(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*(?:דק|דקות|min\b|minutes\b)׳?/i;
const EDGE_SEPARATORS = /^\s*[-–—•/]\s*|\s*[-–—•/]\s*$/g;

/**
 * What the note adds beyond the metric and the pace already on the row —
 * "הליכה", "ג׳וג", "מתגברת", "לא מהר מזה!". Empty when the note was only a
 * restatement of them.
 *
 * A prose step is returned untouched: stripping "30-40 דק׳" out of
 * "אופציה ל30-40 דק׳ קל בערב" leaves "אופציה ל קל בערב", which is worse than the
 * duplication it was avoiding.
 */
export function stepQualifier(step: WorkoutStep): string {
  let note = (step.notes || '').replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!note) return '';
  if (isProseStep(step)) return note;

  const [pace] = stepPaceTokens(step);
  if (pace) {
    // Removed as a range AND as each bound, because the note writes "4:50-5:30"
    // with a hyphen while the pace token uses an en dash.
    note = note.replace(pace, ' ');
    for (const bound of pace.split('–')) note = note.replace(bound, ' ');
  }
  if (durationRangeFromNotes(step.notes)) note = note.replace(MINUTES_PHRASE, ' ');

  return note.replace(/\s+/g, ' ').replace(EDGE_SEPARATORS, '').trim();
}

/** A recovery leg — rendered in a lighter weight, never as the block's headline. */
export function isRestStep(step: WorkoutStep): boolean {
  return step.type === 'rest' || step.type === 'recovery';
}

/**
 * True when a repeat block has more than one WORKING leg, i.e. its legs don't
 * share a pace and so can't share one right-aligned pace chip.
 *
 * Thursday is 6 × (9 דק׳ @4:25 + 1 דק׳ @3:40) — the surge at 3:40 is the point
 * of the session, and showing only the lead pace hid it completely.
 */
export function repeatHasMultiplePaces(step: WorkoutStep): boolean {
  const legs = step.repeatSteps || [];
  return legs.filter((leg) => !isRestStep(leg)).length > 1;
}
