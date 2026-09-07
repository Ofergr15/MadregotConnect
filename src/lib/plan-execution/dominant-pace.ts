/**
 * Which stretch of a run the pace row is about, and what the watch or the trace
 * says the athlete ran over it.
 *
 * "Did you hit the pace you were asked to run" is not a question about the run's
 * average. A plan of "2 km easy, 20 km at 4:25, 8×15 s strides" prescribes three
 * paces and the average is none of them — on the club's real data that reads 4:33
 * against 4:25 and calls a perfectly run session slow. So the pace row describes
 * ONE stretch: the step the watch says was the session's main work if the run was
 * driven by a structured workout, else the longest graded block the search could
 * locate on the distance axis.
 *
 * This lives in one module because three surfaces make the substitution — the run
 * detail (`?verdict=1`), the feed's rings, and any replay script judging a grading
 * change against stored data — and a fourth thing depends on it in a way that is
 * easy to lose: `comparedMin`/`comparedMax`. `buildVerdict` withholds the score
 * outright when a pace was prescribed and never checked, which is exactly
 * `comparedMin == null` — the state the whole-run average is left in on a
 * structured session. So a copy of this that forgets to set them doesn't grade the
 * pace slightly differently, it shows the athlete a dashed ring and "nothing to
 * compare" with the answer sitting right beside it.
 */

import type { WorkoutAdherence } from '@/lib/academy/adherence';
import { dominantBlock, type BlockReport } from '@/lib/academy/execution';
import { dominantWatchStep, partialWatchStep, type WatchStepReport } from '@/lib/academy/watch-steps';
import type { ExecutionPaceScope } from './verdict';

export interface DominantPace {
  /** The adherence pace row, with the dominant step's or block's answer in it. */
  pace: WorkoutAdherence['pace'];
  /** Which stretch that row describes, or null when nothing could be located. */
  paceScope: ExecutionPaceScope | null;
}

/**
 * @param gradedPace `assessWorkout(...).pace` — the whole-run row, returned
 *   unchanged when neither the watch nor the trace can say anything.
 * @param watched `gradeWatchSteps(...)`, or null for a run nobody pushed.
 * @param blocks `gradePlanBlocks(...)`, or null when the run has no usable trace.
 */
export function resolveDominantPace(
  gradedPace: WorkoutAdherence['pace'],
  watched: WatchStepReport | null,
  blocks: BlockReport | null,
): DominantPace {
  // The watch's own step wins over the searched block: same question, same
  // "one dominant answer" rule, evidence instead of inference. It also fixes a
  // case the search cannot — an athlete running a workout of their own making was
  // graded against the club plan's structure, which on one real Sunday turned her
  // 22 km at 4:48 (her own step said 4:35–4:45: on target) into "slower".
  const watchStep = watched ? dominantWatchStep(watched) : null;
  // Not `watchStep ?? dominantBlock(blocks)` in one expression: the two verdict
  // shapes differ (a step has no window on the distance axis), and keeping them
  // apart lets each be read for what it is instead of through `'window' in x`.
  const block = watchStep || !blocks ? null : dominantBlock(blocks);
  // Last, and only when nothing COMPLETE could be graded: the watch's own account of
  // a step the run cut short. A run that stopped 8 km early has no untruncated step
  // and no block that fits either, and the alternative to this is what the club was
  // actually shown — a dashed ring beside a 4:35 target the watch itself had already
  // marked on target. Never in place of a complete answer, and never from the block
  // search, whose truncated window is "everything from the cursor to wherever the run
  // ended" rather than a stretch the device named. See `partialWatchStep`.
  const partial = watchStep || block || !watched ? null : partialWatchStep(watched);
  const step = watchStep ?? partial;
  const dominant = step ?? block;

  const paceScope: ExecutionPaceScope | null = step
    ? {
      label: step.label,
      // The watch names a step, not a stretch of the distance axis: it can report
      // the same step several times over (eight strides), so there is no single
      // from/to to give. The step-by-step report carries that detail.
      fromM: null,
      toM: null,
      plannedLengthM: step.plannedDistanceM,
      ranLengthM: step.actualDistanceM,
      truncated: step.truncated,
      resolutionM: null,
      source: 'watch',
    }
    : block && blocks
      ? {
        label: block.label,
        fromM: block.window?.startM ?? null,
        toM: block.window?.endM ?? null,
        plannedLengthM: block.plannedLengthM,
        ranLengthM: block.window ? Math.round(block.window.endM - block.window.startM) : null,
        truncated: block.truncated,
        resolutionM: blocks.resolutionM,
        source: blocks.source,
      }
      : null;

  if (!dominant) return { pace: gradedPace, paceScope };
  return {
    pace: {
      ...gradedPace,
      status: dominant.status,
      // The block's own band, shown as well as compared against: the row now
      // describes that block, and printing the whole session's work band beside a
      // block's pace labels a 4:25 number "4:35 planned".
      plannedMin: dominant.plannedPaceMin,
      plannedMax: dominant.plannedPaceMax,
      comparedMin: dominant.plannedPaceMin,
      comparedMax: dominant.plannedPaceMax,
      actual: dominant.actualPace,
    },
    paceScope,
  };
}
