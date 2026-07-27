import { ParsedWorkout, WorkoutStep, GroupedWeeklyPlans } from './ai/types';
import { formatPace } from './garmin/pace';

/**
 * Renders a workout as plain, copy-pasteable text for sharing (WhatsApp, social,
 * etc.), matching the coach's notation:
 *
 *   2min @ 3:25 (3:35) ((3:45))      ← Group ❶ plain, ❷ single (), ❸ double (())
 *   6km @ 4:15 (4:24) ((4:36))
 *   5×
 *   45sec uphill @ 90%
 *   2min @ All-Out
 *   Warm-up
 *   Cool-down
 *
 * The three per-group paces come from the stored GroupedWeeklyPlans (group1/2/3),
 * which hold the same workout with each step's pace resolved to that group. We
 * zip the matching step across the three groups back into the bracket notation.
 */

// --- duration / distance rendering ---

function formatDuration(step: WorkoutStep): string {
  if (step.durationType === 'distance' && step.durationValue) {
    const m = step.durationValue;
    if (m >= 1000) {
      const km = m / 1000;
      return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)}km`;
    }
    return `${m}m`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    const s = step.durationValue;
    if (s % 60 === 0) return `${s / 60}min`;
    if (s < 60) return `${s}sec`;
    // mixed min+sec, e.g. 90s -> "1min 30sec"
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}min ${sec}sec`;
  }
  return ''; // open / lap-button
}

// --- pace / target rendering ---

// A single group's pace token: "3:30" or "3:30–3:40" (only when a real range).
function paceToken(step: WorkoutStep | undefined): string {
  if (!step || step.targetType !== 'pace' || !step.targetPaceMinPerKm) return '';
  const min = step.targetPaceMinPerKm;
  const max = step.targetPaceMaxPerKm;
  if (max && max !== min) return `${formatPace(min)}–${formatPace(max)}`;
  return formatPace(min);
}

// "3:25 (3:35) ((3:45))" from the three group variants of the same step.
// Groups with no pace collapse gracefully (single-pace workouts show one token).
function combinedPace(s1?: WorkoutStep, s2?: WorkoutStep, s3?: WorkoutStep): string {
  const t1 = paceToken(s1);
  const t2 = paceToken(s2);
  const t3 = paceToken(s3);
  if (!t1 && !t2 && !t3) return '';
  const parts: string[] = [];
  if (t1) parts.push(t1);
  if (t2 && t2 !== t1) parts.push(`(${t2})`);
  if (t3 && t3 !== t1) parts.push(`((${t3}))`);
  return parts.join(' ');
}

// Effort/zone words the coach uses when there's no numeric pace — pulled from the
// step notes (e.g. "All-Out", "90%", "easy jog", "uphill").
function effortSuffix(step: WorkoutStep): string {
  const notes = (step.notes || '').trim();
  if (!notes) return '';
  // If notes are just a pace token, it's handled by combinedPace already.
  if (/^\d+:\d{2}/.test(notes)) return '';
  return notes;
}

const TYPE_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
  rest: 'recovery',
  recovery: 'recovery',
};

// One rendered line for a single (non-repeat) step, using the three group
// variants for pace. Returns '' if there's nothing meaningful to show.
function renderStep(s1: WorkoutStep, s2?: WorkoutStep, s3?: WorkoutStep): string {
  const dur = formatDuration(s1);
  const pace = combinedPace(s1, s2, s3);
  const effort = pace ? '' : effortSuffix(s1);

  // Bare warm-up / cool-down with no duration or target → just the label.
  if (!dur && !pace && !effort) {
    return TYPE_LABELS[s1.type] || '';
  }

  const label =
    s1.type === 'warmup' ? 'Warm-up' :
    s1.type === 'cooldown' ? 'Cool-down' :
    (s1.type === 'rest' || s1.type === 'recovery') ? 'recovery' : '';

  // The "@" prefix only makes sense with a duration in front of it. A step that
  // is just free-text (easy runs like "70 דק׳ 4:50-5:30", full descriptions)
  // prints the text as-is; "@" with no leading duration reads as broken.
  const target = pace ? `@ ${pace}` : effort ? (dur ? `@ ${effort}` : effort) : '';

  // Recovery/rest reads "2min recovery"; others "2min @ 3:25 (…)".
  if (label === 'recovery') {
    return [dur, label].filter(Boolean).join(' ').trim();
  }
  if (label) {
    // Warm-up / Cool-down with detail: "Warm-up 2km @ 4:40" or just "Warm-up".
    return [label, dur, target].filter(Boolean).join(' ').trim();
  }
  return [dur, target].filter(Boolean).join(' ').trim();
}

// Render a step and its group-2/3 counterparts. Handles repeat blocks:
//   N×
//   <sub-step lines>
function renderTopStep(
  s1: WorkoutStep,
  s2: WorkoutStep | undefined,
  s3: WorkoutStep | undefined,
  lines: string[],
): void {
  if (s1.repeatCount && s1.repeatSteps && s1.repeatSteps.length) {
    lines.push(`${s1.repeatCount}×`);
    s1.repeatSteps.forEach((sub, i) => {
      const line = renderStep(sub, s2?.repeatSteps?.[i], s3?.repeatSteps?.[i]);
      if (line) lines.push(line);
    });
    return;
  }
  const line = renderStep(s1, s2, s3);
  if (line) lines.push(line);
}

/**
 * Build the shareable text for one day across the three groups. Pass the same
 * dayOfWeek's workout from group1/2/3 (group2/group3 optional — falls back to
 * single-pace output).
 */
export function workoutToShareText(
  w1: ParsedWorkout,
  w2?: ParsedWorkout,
  w3?: ParsedWorkout,
): string {
  const lines: string[] = [];
  w1.steps.forEach((step, i) => {
    renderTopStep(step, w2?.steps?.[i], w3?.steps?.[i], lines);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Given the stored GroupedWeeklyPlans and a dayOfWeek, return the shareable text
 * for that day (or null if there's no workout that day). Matches the three
 * groups by dayOfWeek so paces line up as ❶ (❷) ((❸)).
 */
export function shareTextForDay(
  grouped: GroupedWeeklyPlans,
  dayOfWeek: number,
): string | null {
  const find = (plan: { workouts: ParsedWorkout[] }) =>
    plan.workouts.find((w) => w.dayOfWeek === dayOfWeek);
  const w1 = find(grouped.group1);
  if (!w1 || !w1.steps.length) return null;
  const w2 = grouped.group2 ? find(grouped.group2) : undefined;
  const w3 = grouped.group3 ? find(grouped.group3) : undefined;
  const body = workoutToShareText(w1, w2, w3);
  return body || null;
}
