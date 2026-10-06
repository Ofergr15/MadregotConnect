import type { ExecutionVerdict } from '@/lib/plan-execution/verdict';
import type { EffortReport } from './segments';

// Kept apart from report.ts (which talks to Supabase) so the trainee's sheet
// builder and its tests can share it without a database client in the import graph.

/**
 * The work pace of a session, off the same evidence its score read: the aligned
 * reps when the laps lined up step for step, else the reps the effort search found.
 * Interval/active reps only — a warmup is not the work.
 */
export function workPaceOf(
  verdict: Pick<ExecutionVerdict, 'reps'>,
  efforts: Pick<EffortReport, 'requirements'> | null,
): { actual: number; min: number; max: number } | null {
  const reps = verdict.reps.filter((r) => r.graded
    && (r.type === 'interval' || r.type === 'active')
    && r.actualPace != null && r.plannedPaceMin != null);
  if (reps.length) {
    const mean = reps.reduce((sum, r) => sum + (r.actualPace as number), 0) / reps.length;
    return {
      actual: Math.round(mean),
      min: reps[0].plannedPaceMin as number,
      max: (reps[0].plannedPaceMax ?? reps[0].plannedPaceMin) as number,
    };
  }
  const requirement = (efforts?.requirements ?? []).find((q) => q.verifiable && q.paces.length > 0);
  if (!requirement) return null;
  const mean = requirement.paces.reduce((sum, p) => sum + p, 0) / requirement.paces.length;
  return { actual: Math.round(mean), min: requirement.paceMin, max: requirement.paceMax };
}
