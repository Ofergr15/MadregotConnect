import type { WatchStepReport } from '@/lib/academy/watch-steps';
import type { StoredLap } from '@/lib/garmin/laps';

/**
 * PROPOSAL, not wired into any surface. A comparison for review against the current
 * `WatchStepReport.complete` (every step run at least once). It separates the questions the current
 * flag merges, and refuses to count when the laps can't support a count:
 *
 *   reps        — 'all_done' | 'missing' | 'unknown': repeated WORK steps only, from the watch's stamps
 *   onPace      — of the targeted reps run, how many were in the band (unchanged numbers)
 *   skipped     — labels of non-repeated steps never run (a cooldown cut short is named, not hidden)
 *
 * No fabrication: when the run has unstamped laps (a lap the watch didn't tie to a step) and the stamped
 * reps fall short, the reps answer is 'unknown' — the missing rep may be sitting in an unstamped lap.
 */
export interface RepCompletion {
  reps: 'all_done' | 'missing' | 'unknown';
  repsRun: number;
  repsPlanned: number;
  onPace: { inBand: number; targeted: number };
  skipped: string[];
}

export function proposedRepCompletion(report: WatchStepReport | null, laps: StoredLap[]): RepCompletion | null {
  if (!report || report.repeatsPlanned === 0) return null;
  const unstamped = laps.some(l => l.wktStepIndex == null) && laps.some(l => l.wktStepIndex != null);
  const short = report.repeatsRun < report.repeatsPlanned;
  return {
    reps: !short ? 'all_done' : unstamped ? 'unknown' : 'missing',
    repsRun: report.repeatsRun,
    repsPlanned: report.repeatsPlanned,
    onPace: { inBand: report.repeatsOnTarget, targeted: report.repeatsWithTarget },
    skipped: report.steps.filter(s => s.plannedRepeats <= 1 && s.ranRepeats === 0).map(s => s.label),
  };
}
