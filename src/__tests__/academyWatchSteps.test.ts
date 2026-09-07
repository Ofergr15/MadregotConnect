import { describe, expect, it } from 'vitest';
import { dominantWatchStep, gradeWatchSteps, groupLapsByStep } from '@/lib/academy/watch-steps';
import { narrowExecutedWorkout } from '@/lib/garmin/executed-workout';
import { normalizeStoredLaps, type StoredLap } from '@/lib/garmin/laps';

/**
 * Grading a run against the workout the WATCH ran.
 *
 * Everything else in the academy engine infers which part of the plan a stretch of
 * running was, because most runs give us only distance and time. This path exists for
 * the runs where nothing needs inferring: Garmin stamped every lap with the step it
 * executed, and the activity carries the step list that index points into.
 *
 * The fixtures are the club's real published Sunday and one athlete's own workout for
 * the same day, because that pair is the reason this reads the watch's step list rather
 * than our parsed plan: the two structures differ, every index still lands in range,
 * and grading against the plan silently reported a 22 km warm-up.
 */

const sundayRaw = [{
  workoutName: 'ראשון 6.9',
  timeCreated: '2026-09-05T19:32:54.0',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: '5:00-5:30' },
    { stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 20000, notes: '4:25 (4:35) ((4:45))' },
    { stepIndex: 2, intensity: 'ACTIVE', durationType: 'TIME', durationValue: 15, notes: 'עלייה' },
    { stepIndex: 3, intensity: 'REST', durationType: 'TIME', durationValue: 45, targetType: 'OPEN', notes: 'הליכה בירידה' },
    { stepIndex: 4, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 2, targetValue: 8 },
  ],
}];
const sunday = narrowExecutedWorkout(sundayRaw)!;

const lap = (
  distance: number, duration: number, wktStepIndex?: number, extra: Partial<StoredLap> = {},
): StoredLap => ({
  distance, duration,
  averagePace: distance > 0 ? Math.round(duration / (distance / 1000)) : null,
  averageHR: null, maxHR: null,
  ...(wktStepIndex != null ? { wktStepIndex } : {}),
  ...extra,
});

/** The session as a watch recorded it: 2 warm-up laps, 20 auto-laps of block, 8 strides. */
const sundayLaps = (blockPace = 268): StoredLap[] => [
  lap(1000, 310, 0), lap(1000, 314, 0),
  ...Array.from({ length: 20 }, () => lap(1000, blockPace, 1)),
  ...Array.from({ length: 8 }, () => [lap(75, 15, 2), lap(90, 45, 3)]).flat(),
];

describe('groupLapsByStep', () => {
  // Twenty auto-laps inside one block are one time through step 1, not twenty.
  it('groups consecutive laps of the same step into one occurrence', () => {
    expect(groupLapsByStep(sundayLaps()).map(g => [g.stepIndex, g.laps.length])).toEqual([
      [0, 2], [1, 20],
      ...Array.from({ length: 8 }, () => [[2, 1], [3, 1]]).flat(),
    ]);
  });

  it('ignores the laps the watch did not stamp', () => {
    expect(groupLapsByStep([lap(500, 200), lap(1000, 300, 1), lap(400, 120)]))
      .toEqual([{ stepIndex: 1, laps: [lap(1000, 300, 1)] }]);
  });
});

describe('gradeWatchSteps', () => {
  it('grades every step against the one it actually was', () => {
    const report = gradeWatchSteps(sunday, sundayLaps(), 1)!;
    expect(report.workoutName).toBe('ראשון 6.9');
    expect(report.steps.map(s => [s.index, s.label, s.actualDistanceM, s.actualPace, s.status]))
      .toEqual([
        [0, 'Warmup 2km', 2000, 312, 'on_target'],
        [1, 'Run 20km', 20000, 268, 'on_target'],
        // "עלייה" is an instruction, not a pace — the strides happened, ungraded.
        [2, 'Run 15s', 600, 200, 'unknown'],
        [3, 'Rest 45s', 720, 500, 'unknown'],
      ]);
    expect(report).toMatchObject({ gradedCount: 2, onTargetCount: 2, complete: true });
  });

  /**
   * The same run, graded for a slower lane. The coach writes one step with three paces —
   * "4:25 (4:35) ((4:45))" — so a lane-3 athlete asked for 4:45 and a lane-1 athlete
   * asked for 4:25 ran the same 4:28 to two different verdicts. Grading everyone against
   * the first number is the mistake this prevents.
   */
  it('grades the athlete against their own lane', () => {
    const laps = sundayLaps();
    expect(gradeWatchSteps(sunday, laps, 1)!.steps[1]).toMatchObject({
      plannedPaceMin: 265, status: 'on_target',
    });
    expect(gradeWatchSteps(sunday, laps, 3)!.steps[1]).toMatchObject({
      plannedPaceMin: 285, status: 'faster',
    });
  });

  /**
   * The rep count a coach actually asks about, straight off the watch: no lap needs to be
   * the right length or the right pace to be counted, which is the whole weakness of
   * finding reps by searching — a stride run 40 s/km off target comes out the wrong
   * LENGTH and vanishes, while the watch still knows it was stride number six.
   */
  it('counts the reps run, separately from the reps run on pace', () => {
    const report = gradeWatchSteps(sunday, [
      lap(1000, 310, 0), lap(1000, 314, 0),
      ...Array.from({ length: 20 }, () => lap(1000, 268, 1)),
      ...Array.from({ length: 6 }, () => [lap(75, 15, 2), lap(90, 45, 3)]).flat(),
    ], 1)!;
    // Six of eight strides, and no pace was asked for them, so none are "off pace".
    expect(report).toMatchObject({
      repeatsPlanned: 8, repeatsRun: 6, repeatsWithTarget: 0, repeatsOnTarget: 0,
    });
    expect(report.steps[2]).toMatchObject({ ranRepeats: 6, plannedRepeats: 8, truncated: true });
    expect(report.complete).toBe(true); // every step was run at least once
  });

  it('counts on-pace reps when the coach did set a target for them', () => {
    const paced = narrowExecutedWorkout([{
      workoutName: '6x400', steps: [
        { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000, notes: '5:00-5:30' },
        { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 400, notes: '3:20 (3:25) ((3:30))' },
        { stepIndex: 2, intensity: 'RECOVERY', durationType: 'DISTANCE', durationValue: 200, notes: 'הליכה' },
        { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 6 },
      ],
    }])!;
    const report = gradeWatchSteps(paced, [
      lap(1000, 320, 0), lap(1000, 320, 0),
      ...Array.from({ length: 4 }, () => [lap(400, 80, 1), lap(200, 84, 2)]).flat(),
      lap(400, 88, 1), lap(200, 84, 2),   // 3:40 — the rep happened, off pace
      lap(400, 89, 1), lap(200, 84, 2),
    ], 1)!;
    expect(report).toMatchObject({
      repeatsPlanned: 6, repeatsRun: 6, repeatsWithTarget: 6, repeatsOnTarget: 4,
    });
    expect(report.steps[1].occurrences.map(o => o.status))
      .toEqual(['on_target', 'on_target', 'on_target', 'on_target', 'slower', 'slower']);
  });

  // A timed step is judged on the clock, because that is the axis the workout named: a
  // 15-second stride is 15 seconds at any pace, and the metres are the consequence.
  it('measures a timed step against its time and a measured one against its distance', () => {
    const report = gradeWatchSteps(sunday, [
      lap(1000, 310, 0), lap(1000, 314, 0),
      ...Array.from({ length: 20 }, () => lap(1000, 268, 1)),
      // Eight strides at half the pace: far short on metres, exactly right on time.
      ...Array.from({ length: 8 }, () => [lap(38, 15, 2), lap(90, 45, 3)]).flat(),
    ], 1)!;
    expect(report.steps[2]).toMatchObject({
      plannedDurationSec: 120, actualDurationSec: 120, plannedDistanceM: null,
      truncated: false, ranRepeats: 8,
    });
  });

  it('knows a step that was cut short', () => {
    const report = gradeWatchSteps(sunday, [
      lap(1000, 310, 0), lap(1000, 314, 0),
      ...Array.from({ length: 6 }, () => lap(1000, 268, 1)),
    ], 1)!;
    expect(report.steps[1]).toMatchObject({ actualDistanceM: 6000, truncated: true });
    expect(report.complete).toBe(false);
    // Six kilometres of a twenty-kilometre block were on pace, and saying so on its own
    // would read as "did the session". The dominant-step rule is what refuses it.
    expect(report.steps[1].status).toBe('on_target');
    expect(dominantWatchStep(report)).toBeNull();
  });

  /**
   * One athlete's Sunday, off a workout of their own: a single OPEN step with the whole
   * session in its note. Nothing measurable was asked for, so nothing about it is short —
   * and the pace still grades, because the coach wrote it in the prose.
   */
  it('grades an open-ended step without ever calling it cut short', () => {
    const own = narrowExecutedWorkout([{
      workoutName: 'EZ + intervals ', steps: [
        { stepIndex: 0, intensity: 'ACTIVE', durationType: 'OPEN', targetType: 'OPEN', notes: '22km - 4:35-4:45' },
        { stepIndex: 1, intensity: 'ACTIVE', durationType: 'TIME', durationValue: 15, targetType: 'OPEN' },
        { stepIndex: 2, intensity: 'RECOVERY', durationType: 'TIME', durationValue: 45, targetType: 'OPEN' },
        { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 8 },
      ],
    }])!;
    const report = gradeWatchSteps(own, [
      ...Array.from({ length: 22 }, () => lap(1000, 280, 0)),
      ...Array.from({ length: 8 }, () => [lap(73, 15, 1), lap(70, 45, 2)]).flat(),
      lap(904, 284),
    ], 2)!;
    expect(report.steps[0]).toMatchObject({
      label: 'Run', plannedDistanceM: null, plannedDurationSec: null,
      actualDistanceM: 22000, actualPace: 280, status: 'on_target', truncated: false,
    });
    expect(report).toMatchObject({ repeatsRun: 8, repeatsPlanned: 8, unstampedLaps: 1 });
    expect(dominantWatchStep(report)!.actualDistanceM).toBe(22000);
  });

  it('counts the laps the watch never stamped', () => {
    const report = gradeWatchSteps(sunday, [lap(400, 150), ...sundayLaps(), lap(600, 240)], 1)!;
    expect(report.unstampedLaps).toBe(2);
    expect(report.steps[0].actualDistanceM).toBe(2000);
  });

  describe('when it must not answer', () => {
    it('says nothing for a run the watch did not drive', () => {
      expect(gradeWatchSteps(sunday, normalizeStoredLaps([
        { distance: 1000, duration: 300 }, { distance: 1000, duration: 300 },
      ]), 1)).toBeNull();
      expect(gradeWatchSteps(null, sundayLaps(), 1)).toBeNull();
    });

    it('says nothing for a workout of nothing but repeat markers', () => {
      const empty = narrowExecutedWorkout([{
        workoutName: 'x',
        steps: [{ stepIndex: 0, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 0, targetValue: 2 }],
      }])!;
      expect(gradeWatchSteps(empty, sundayLaps(), 1)).toBeNull();
    });

    it('refuses a mapping whose indices do not fit the step list', () => {
      const stale = Array.from({ length: 8 }, () => [lap(400, 82, 9), lap(200, 90, 11)]).flat();
      expect(gradeWatchSteps(sunday, stale, 1)).toBeNull();
    });

    // One stray index is a payload oddity, not a different workout.
    it('tolerates a single index it cannot place', () => {
      const report = gradeWatchSteps(sunday, [...sundayLaps(), lap(300, 100, 9)], 1);
      expect(report).not.toBeNull();
      expect(report!.steps[1].actualPace).toBe(268);
    });
  });

  describe('grade-adjusted pace', () => {
    // A block run uphill is not a slower block, so the fairer number is carried
    // alongside — but only when every lap of the step has one. A mean over the half of
    // the laps that reported it is not the step's pace, it is that half's pace.
    it('carries a grade-adjusted pace only when the whole step has one', () => {
      const withGap = [
        lap(1000, 310, 0), lap(1000, 314, 0),
        ...Array.from({ length: 20 }, () => lap(1000, 268, 1, { gradeAdjustedPace: 264 })),
      ];
      expect(gradeWatchSteps(sunday, withGap, 1)!.steps[1].gradeAdjustedPace).toBe(264);

      const partial = withGap.map((l, i) => (i === 5 ? lap(1000, 268, 1) : l));
      expect(gradeWatchSteps(sunday, partial, 1)!.steps[1].gradeAdjustedPace).toBeNull();
    });

    it('averages heart rate over time, not over laps', () => {
      const report = gradeWatchSteps(sunday, [
        lap(1000, 310, 0, { averageHR: 130 }),
        lap(1000, 314, 0, { averageHR: 140 }),
        ...Array.from({ length: 20 }, () => lap(1000, 268, 1, { averageHR: 160 })),
      ], 1)!;
      expect(report.steps[0].averageHR).toBe(135);
      expect(report.steps[1].averageHR).toBe(160);
    });
  });

  describe('dominantWatchStep', () => {
    it('picks the block, never the warm-up', () => {
      expect(dominantWatchStep(gradeWatchSteps(sunday, sundayLaps(), 1)!))
        .toMatchObject({ label: 'Run 20km', actualPace: 268 });
    });

    /**
     * On a pure interval day the warm-up jog is often the longest single thing in the
     * run. Answering with it would tell the athlete they ran their 6×400 at 5:20, so the
     * warm-up is never the headline — the reps are, or nothing is.
     */
    it('reports the reps on an interval day, not the jog that preceded them', () => {
      const intervals = narrowExecutedWorkout([{
        workoutName: '6x400', steps: [
          { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 3000, notes: '5:00-5:30' },
          { stepIndex: 1, intensity: 'INTERVAL', durationType: 'DISTANCE', durationValue: 400, notes: '3:20' },
          { stepIndex: 2, intensity: 'RECOVERY', durationType: 'DISTANCE', durationValue: 200, notes: 'הליכה' },
          { stepIndex: 3, durationType: 'REPEAT_UNTIL_STEPS_CMPLT', durationValue: 1, targetValue: 6 },
        ],
      }])!;
      const report = gradeWatchSteps(intervals, [
        ...Array.from({ length: 3 }, () => lap(1000, 320, 0)),
        ...Array.from({ length: 6 }, () => [lap(400, 80, 1), lap(200, 84, 2)]).flat(),
      ], 1)!;
      expect(dominantWatchStep(report)!.label).toBe('Interval 400m');
    });
  });
});
