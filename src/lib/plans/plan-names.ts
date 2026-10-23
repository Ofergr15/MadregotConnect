import type { ParsedWorkout } from '@/lib/ai/types';
import { workoutTitle } from '@/lib/day-session/workout';

// The names a week's sessions go out under (mockup ~/.cache/madregot/plan-names, Ofer 10-23:
// "confirm it with us when we enter a plan — show the names and let us edit"). A suggestion
// is built from the steps; the staff approve or rewrite it, and a matched run takes it.

/** What the steps spell ("10 × 1600"), falling back to the coach's own session name. */
export function suggestedName(w: ParsedWorkout): string {
  let fromSteps = '';
  try { fromSteps = workoutTitle(w.steps || []).trim(); } catch { /* steps the headline can't read */ }
  return fromSteps || (w.name || '').trim();
}

/** The name in force: the approved one, else the suggestion. */
export const nameOf = (w: ParsedWorkout) => (w.workoutName?.trim() || suggestedName(w));

/** The quick picks under the edit field, without repeats. */
export function nameSuggestions(w: ParsedWorkout): string[] {
  return [...new Set([suggestedName(w), (w.name || '').trim()].filter(Boolean))];
}
