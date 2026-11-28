import { describe, expect, it } from 'vitest';
import { assessWorkout, buildPlannedWorkout } from '@/lib/academy/adherence';
import { dominantBlock, gradeWorkoutBlocks, traceFromLaps, traceFromStream } from '@/lib/academy/execution';
import { findPlannedEfforts, flattenPlannedSteps } from '@/lib/academy/segments';
import { dominantWatchStep, gradeWatchSteps, partialWatchStep } from '@/lib/academy/watch-steps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import { normalizeStoredLaps } from '@/lib/garmin/laps';
import { VERDICT_RUNS } from './fixtures/verdict-runs';

/**
 * Snapshot of what each of the four verdict engines (CLAUDE.md, "Did they do the
 * workout") answers for ten anonymised real-shape runs. Not a statement that every
 * answer is right — gradingProductionFailures pins the ones that must be — but a
 * tripwire: any change to an engine shows up here as a diff of verdicts, and a PR
 * that moves one has to show (and justify) the moved line. Regenerate on purpose
 * with `npx vitest run src/__tests__/verdictSnapshots.test.ts -u`.
 *
 * The digest keeps what a screen shows (status, pace, counts, the one headline
 * verdict) and leaves out search internals, so a refactor that does not change an
 * answer does not change the snapshot.
 */

const r = (n: number | null | undefined) => (n == null ? null : Math.round(n));

describe.each(VERDICT_RUNS)('$id — $story', (run) => {
  const laps = normalizeStoredLaps(run.laps);
  const planned = flattenPlannedSteps(run.workout);

  it('assessWorkout (distance / time / whole-run pace)', () => {
    const a = assessWorkout(buildPlannedWorkout(run.workout, run.actual.date), run.actual);
    expect({
      distance: [a.distance.status, r(a.distance.actual), r(a.distance.plannedMin), r(a.distance.plannedMax)],
      duration: [a.duration.status, a.duration.estimated],
      pace: [a.pace.status, r(a.pace.actual), a.pace.comparedMin, a.pace.comparedMax],
      score: Math.round(a.score * 100),
    }).toMatchSnapshot();
  });

  it('gradePlanBlocks (pace per block, on the trace)', () => {
    const trace = (run.stream && traceFromStream(run.stream)) || traceFromLaps(laps);
    const report = gradeWorkoutBlocks(run.workout, trace);
    const top = dominantBlock(report);
    expect({
      source: report.source,
      resolutionM: r(report.resolutionM),
      reason: report.reason ?? null,
      graded: `${report.onTargetCount}/${report.gradedCount}`,
      blocks: report.blocks.map(b => `${b.label} | ${b.status} | ${r(b.actualPace) ?? '-'}${b.truncated ? ' | truncated' : ''}`),
      dominant: top ? `${top.label} ${top.status}` : null,
    }).toMatchSnapshot();
  });

  it('findPlannedEfforts (reps, from laps)', () => {
    const report = findPlannedEfforts(planned, laps);
    expect({
      verdict: report.verdict,
      totals: `${report.foundTotal}/${report.attemptedTotal}/${report.neededTotal}`,
      requirements: report.requirements.map(q => `${q.label} by ${q.matchBy}: ${q.found}/${q.attempted}/${q.needed}`),
    }).toMatchSnapshot();
  });

  it('gradeWatchSteps (the device\'s own steps + stamped laps)', () => {
    const report = gradeWatchSteps(narrowExecutedWorkout(run.executed), laps, run.lane);
    if (!report) {
      expect(run.executed).toBeNull();
      return;
    }
    const top = dominantWatchStep(report);
    const partial = top ? null : partialWatchStep(report);
    expect({
      workoutName: report.workoutName,
      complete: report.complete,
      graded: `${report.onTargetCount}/${report.gradedCount}`,
      repeats: `${report.repeatsOnTarget}/${report.repeatsWithTarget} on target, ${report.repeatsRun}/${report.repeatsPlanned} run`,
      unstampedLaps: report.unstampedLaps,
      steps: report.steps.map(s => `#${s.index} ${s.label} | ${s.status} | ${r(s.actualPace) ?? '-'} | ${s.ranRepeats}/${s.plannedRepeats}${s.truncated ? ' | truncated' : ''}`),
      dominant: top ? `#${top.index} ${top.status}` : null,
      partial: partial ? `#${partial.index} ${partial.status}` : null,
    }).toMatchSnapshot();
  });
});

describe('the fixture set', () => {
  it('is ten runs with unique ids, and the watch engine has evidence on at least five', () => {
    expect(VERDICT_RUNS).toHaveLength(10);
    expect(new Set(VERDICT_RUNS.map(x => x.id)).size).toBe(10);
    expect(VERDICT_RUNS.filter(x => x.executed).length).toBeGreaterThanOrEqual(5);
  });
  it('carries no personal data: no names, emails, GPS or real ids', () => {
    const wire = JSON.stringify(VERDICT_RUNS);
    expect(wire).not.toMatch(/@|"lat"|"lng"|gps|athlete_id|garmin_activity_id/i);
  });
});
