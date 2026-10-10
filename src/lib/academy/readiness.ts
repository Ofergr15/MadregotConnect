import type { LoadStatus } from './pmc';
import { formBand } from './form-bands';

/**
 * Is this trainee ready for more? (spec §3.6, mockup C1/C2.)
 *
 * The gate pauses the coach's pace-up suggestion when ANY of: form ≤ −30 (עייף מאוד), the
 * 3-morning RHR flag, pain in the last 7 days, or the average feel of the last 4 runs ≤ 1
 * (חלש). Form only counts once the numbers mean something: a trainee still "learning" or
 * with "insufficient" data is never paused on form — missing data never pauses.
 */

export type GateReason = 'veryTired' | 'rhr' | 'pain' | 'feel';

/** `workout_feedback.feel` is 0…4 (חלש מאוד…חזק מאוד); ≤ 1 is "חלש". */
export const FEEL_LOW = 1;
export const FEEL_RUNS = 4;

export function readinessGate(input: {
  status: LoadStatus['kind'];
  form: number | null;
  rhrFlag: boolean;
  painLast7: boolean;
  feelAvg4: number | null;
}): { paused: boolean; reasons: GateReason[] } {
  const reasons: GateReason[] = [];
  if (input.status === 'ok' && input.form != null && formBand(input.form).key === 'veryTired') reasons.push('veryTired');
  if (input.rhrFlag) reasons.push('rhr');
  if (input.painLast7) reasons.push('pain');
  if (input.feelAvg4 != null && input.feelAvg4 <= FEEL_LOW) reasons.push('feel');
  return { paused: reasons.length > 0, reasons };
}

/**
 * The mean `feel` of the newest `n` answers that have one, or null with none. Order by
 * the run's date (or the answer's), newest first.
 */
export function feelAverage(
  feedback: Array<{ feel?: number | null; date?: string | null; created_at?: string | null }>,
  n = FEEL_RUNS,
): number | null {
  const answered = feedback
    .filter(f => f.feel != null && Number.isFinite(Number(f.feel)))
    .sort((a, b) => String(b.date ?? b.created_at ?? '').localeCompare(String(a.date ?? a.created_at ?? '')))
    .slice(0, n);
  if (!answered.length) return null;
  return answered.reduce((a, f) => a + Number(f.feel), 0) / answered.length;
}

export type Highlight =
  | { kind: 'veryTiredRhr' }
  | { kind: 'rampTooFast'; ramp: number }
  | { kind: 'pr'; bucket: string; when: 'today' | 'yesterday' }
  | { kind: 'race'; name: string | null; daysLeft: number }
  | { kind: 'noRun'; days: number }
  | { kind: 'none' };

/**
 * The ONE fact a C1 row shows, by priority: very tired with high RHR, then building too
 * fast (ramp ≥ 9), a PR today or yesterday, a race within 7 days, no run for 7+ days.
 */
export function readinessHighlight(input: {
  status: LoadStatus['kind'];
  form: number | null;
  ramp: number | null;
  rhrFlag: boolean;
  pr?: { bucket: string; daysAgo: number } | null;
  race?: { name: string | null; daysLeft: number } | null;
  daysSinceRun?: number | null;
}): Highlight {
  const ok = input.status === 'ok';
  if (ok && input.form != null && formBand(input.form).key === 'veryTired' && input.rhrFlag) return { kind: 'veryTiredRhr' };
  if (ok && input.ramp != null && Math.round(input.ramp) >= 9) return { kind: 'rampTooFast', ramp: Math.round(input.ramp) };
  if (input.pr && input.pr.daysAgo >= 0 && input.pr.daysAgo <= 1) {
    return { kind: 'pr', bucket: input.pr.bucket, when: input.pr.daysAgo === 0 ? 'today' : 'yesterday' };
  }
  if (input.race && input.race.daysLeft >= 0 && input.race.daysLeft <= 7) return { kind: 'race', ...input.race };
  if (input.daysSinceRun != null && input.daysSinceRun >= 7) return { kind: 'noRun', days: input.daysSinceRun };
  return { kind: 'none' };
}

export type ReadinessSort = 'tired' | 'week' | 'name';

/**
 * C1's three orders. `tired`: lowest form first, unknown last. `week`: the least done of
 * the week's plan first, no plan last. `name`: Hebrew collation.
 */
export function sortReadiness<T extends { name: string; form: number | null; weekDone?: number; weekPlanned?: number }>(
  rows: T[],
  mode: ReadinessSort,
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'he');
  const share = (r: T) => (r.weekPlanned && r.weekPlanned > 0 ? (r.weekDone ?? 0) / r.weekPlanned : Infinity);
  return [...rows].sort((a, b) => {
    if (mode === 'tired') {
      if (a.form == null || b.form == null) return a.form == null ? (b.form == null ? byName(a, b) : 1) : -1;
      return a.form - b.form || byName(a, b);
    }
    if (mode === 'week') {
      const d = share(a) - share(b);
      return Number.isNaN(d) || d === 0 ? byName(a, b) : d;
    }
    return byName(a, b);
  });
}

/**
 * C2's sentence on the projected form at the end of next week: `warn` when it would be
 * very tired (≤ −30), `inRange` while it is working hard in the right range, `room` when
 * there is room to add load (mockup: "−3: שומר ✓. יש מקום להוסיף קצת עומס").
 */
export function projectionVerdict(projectedForm: number): 'warn' | 'inRange' | 'room' {
  const key = formBand(projectedForm).key;
  if (key === 'veryTired') return 'warn';
  if (key === 'working') return 'inRange';
  return 'room';
}
