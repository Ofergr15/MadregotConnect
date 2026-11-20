import type { WatchStepReport, WatchStepVerdict } from '@/lib/academy/watch-steps';
import type { StoredLap } from '@/lib/garmin/laps';

/**
 * PROPOSAL, not wired into any surface. A comparison for review against the current
 * `WatchStepReport.complete` (every step run at least once). It separates the questions the current flag
 * merges and is CONSERVATIVE: it says "unknown" rather than a count the laps cannot support.
 *
 *   reps     'all_done' | 'extra' | 'missing' | 'unknown', over repeated WORK steps, from the watch's stamps
 *   reason   why it is 'unknown' (or 'extra'), else null
 *   onPace   of the targeted reps run, how many were in the band (unchanged numbers)
 *   skipped  labels of non-repeated steps never run (a cooldown cut short is named, not hidden)
 *
 * What the input CANNOT settle, so it is never decided here:
 *  - A recovery skipped with the lap button joins two reps into one stamped occurrence of ~2× the rep.
 *    The same laps come from ONE rep run long. Nothing in the stamps tells them apart, so a short set
 *    with an occurrence ≥ 1.5× the planned rep is 'unknown' / 'possible_merged_reps', never 'missing'.
 *  - A rep run inside a lap the watch did not stamp: when the stamped reps fall short and any lap is
 *    unstamped, 'unknown' / 'unstamped_laps'.
 */
export type RepAnswer = 'all_done' | 'extra' | 'missing' | 'unknown';
export type RepReason = 'possible_merged_reps' | 'unstamped_laps' | 'more_than_planned' | null;

export interface RepCompletion {
  reps: RepAnswer;
  reason: RepReason;
  repsRun: number;
  repsPlanned: number;
  /** repsRun − repsPlanned when positive, else 0. */
  extraReps: number;
  onPace: { inBand: number; targeted: number };
  skipped: string[];
}

/** Threshold for "this one occurrence may be two reps": at least 1.5× one planned rep, on the step's own axis. */
export const MERGE_SUSPECT_RATIO = 1.5;

const isWorkRepeat = (v: WatchStepVerdict) => v.plannedRepeats > 1 && v.type !== 'rest' && v.type !== 'recovery';

function maybeMerged(v: WatchStepVerdict): boolean {
  const perRepSec = v.plannedDurationSec != null ? v.plannedDurationSec / v.plannedRepeats : null;
  const perRepM = v.plannedDistanceM != null ? v.plannedDistanceM / v.plannedRepeats : null;
  return v.occurrences.some((o) => perRepSec != null
    ? o.durationSec >= perRepSec * MERGE_SUSPECT_RATIO
    : perRepM != null && o.distanceM >= perRepM * MERGE_SUSPECT_RATIO);
}

export function proposedRepCompletion(report: WatchStepReport | null, laps: StoredLap[]): RepCompletion | null {
  if (!report || report.repeatsPlanned === 0) return null;
  const work = report.steps.filter(isWorkRepeat);
  const unstamped = laps.some((l) => l.wktStepIndex == null) && laps.some((l) => l.wktStepIndex != null);
  const short = report.repeatsRun < report.repeatsPlanned;
  const extra = Math.max(0, report.repeatsRun - report.repeatsPlanned);
  let reps: RepAnswer = 'all_done';
  let reason: RepReason = null;
  if (extra > 0) { reps = 'extra'; reason = 'more_than_planned'; }
  else if (short && work.some(maybeMerged)) { reps = 'unknown'; reason = 'possible_merged_reps'; }
  else if (short && unstamped) { reps = 'unknown'; reason = 'unstamped_laps'; }
  else if (short) { reps = 'missing'; }
  return {
    reps, reason,
    repsRun: report.repeatsRun,
    repsPlanned: report.repeatsPlanned,
    extraReps: extra,
    onPace: { inBand: report.repeatsOnTarget, targeted: report.repeatsWithTarget },
    skipped: report.steps.filter((s) => s.plannedRepeats <= 1 && s.ranRepeats === 0).map((s) => s.label),
  };
}
