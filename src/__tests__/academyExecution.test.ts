import { describe, expect, it } from 'vitest';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import {
  bestWindow,
  dominantBlock,
  gradeWorkoutBlocks,
  paceOverWindow,
  plannedBlocks,
  traceFromLaps,
  traceFromStream,
} from '@/lib/academy/execution';
import { Lap, findPlannedEfforts, flattenPlannedSteps } from '@/lib/academy/segments';
import { assessWorkout, buildPlannedWorkout } from '@/lib/academy/adherence';

/**
 * Block-aligned grading: does the plan get compared to the part of the run it was
 * written about?
 *
 * Every case here is built from the published Sunday session that exposed the bug —
 * "2 km easy, 20 km at 4:25, 8×15 s strides" — because that shape (a warm-up, one
 * long paced block, a tail of short efforts) is what most of the program looks like
 * and it is precisely the shape a whole-run average cannot describe.
 */

let order = 0;
const step = (over: Partial<WorkoutStep>): WorkoutStep => ({
  order: order++,
  type: 'active',
  durationType: 'distance',
  targetType: 'pace',
  ...over,
});

const workout = (steps: WorkoutStep[]): ParsedWorkout => ({ dayOfWeek: 0, name: 'Sunday', steps });

/** The real published session. Group 1 paces. */
const SUNDAY = workout([
  step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
  step({ durationValue: 20000, targetPaceMinPerKm: 265, targetPaceMaxPerKm: 265 }),
  step({
    repeatCount: 8,
    type: 'interval',
    durationType: 'time',
    targetType: 'no_target',
    repeatSteps: [
      step({ type: 'interval', durationType: 'time', durationValue: 15, targetPaceMinPerKm: 200, targetPaceMaxPerKm: 210 }),
      step({ type: 'recovery', durationType: 'time', durationValue: 45, targetType: 'no_target' }),
    ],
  }),
]);

const lap = (distance: number, duration: number): Lap => ({ distance, duration });

/**
 * The laps a watch on 1 km auto-lap records for that session, with the strides
 * marked by hand. Warm-up 2×1 km at 5:00, main block 20×1 km at 4:23, then eight
 * 15-second strides at 3:20 with 45-second walk recoveries.
 */
const sundayLaps: Lap[] = [
  ...Array.from({ length: 2 }, () => lap(1000, 300)),
  ...Array.from({ length: 20 }, () => lap(1000, 263)),
  ...Array.from({ length: 8 }, () => [lap(83, 15), lap(62, 45)]).flat(),
];

describe('traceFromLaps', () => {
  it('accumulates laps into a distance/time axis starting at zero', () => {
    const trace = traceFromLaps([lap(1000, 300), lap(1000, 263)])!;
    expect(trace.d).toEqual([0, 1000, 2000]);
    expect(trace.t).toEqual([0, 300, 563]);
    expect(trace.resolutionM).toBe(1000);
    expect(trace.source).toBe('laps');
  });

  // A double lap-press gives a lap with distance and no time. Kept, it would be a
  // segment of infinite speed inside whatever window covered it.
  it('drops a zero-duration lap', () => {
    const trace = traceFromLaps([lap(1000, 300), lap(5, 0), lap(1000, 263)])!;
    expect(trace.d).toEqual([0, 1000, 2000]);
  });

  it('returns null when there is nothing to build an axis from', () => {
    expect(traceFromLaps([])).toBeNull();
    expect(traceFromLaps(null)).toBeNull();
    expect(traceFromLaps([lap(1000, 0)])).toBeNull();
  });
});

describe('traceFromStream', () => {
  it('reports a stream resolution of a few metres, not a kilometre', () => {
    const trace = traceFromStream({
      t: [0, 1, 2, 3],
      d: [0, 4, 8, 12],
    })!;
    expect(trace.resolutionM).toBe(4);
    expect(trace.source).toBe('stream');
  });

  it('refuses a series whose axes are not the same length', () => {
    expect(traceFromStream({ t: [0, 1], d: [0, 4, 8] })).toBeNull();
    expect(traceFromStream({ t: [0], d: [0] })).toBeNull();
  });

  // Garmin's first sample lands a moment after the start, so the axis begins at
  // 1-3 m — and metre 0 is then off the end of the trace, which is where a window
  // pinned to the start of the run has to begin.
  it('starts the axis at the origin when the first sample does not', () => {
    const trace = traceFromStream({ t: [0, 1, 2, 3], d: [3, 7, 11, 15] })!;
    expect(trace.d).toEqual([0, 3, 7, 11, 15]);
    expect(trace.t).toEqual([0, 0, 1, 2, 3]);
    expect(trace.resolutionM).toBe(4);
  });

  // Shalev Bahalul's 2026-09-06: he stopped for 228 s at 22 km, between the block and
  // the strides. The raw stream counts that in the block's window and reports the 20 km
  // he ran at 4:23 as 4:34 — a missed 4:25 target that his own lap press says he hit.
  it('does not count a pause as time spent running', () => {
    const t = [0, 1, 2, 230, 231];   // 227 s standing still at the 2 m mark
    const d = [0, 1, 2, 2, 5];
    const trace = traceFromStream({ t, d })!;
    expect(trace.t).toEqual([0, 1, 2, 2, 3]);
  });

  // A gap with ground covered is a downsampled stretch, not a stop, and a stop too
  // short to move a verdict is not worth second-guessing the watch over.
  it('keeps a slow stretch and a brief halt', () => {
    expect(traceFromStream({ t: [0, 10, 20], d: [0, 30, 60] })!.t).toEqual([0, 10, 20]);
    expect(traceFromStream({ t: [0, 3, 6], d: [0, 0, 4] })!.t).toEqual([0, 3, 6]);
  });

  // Only a sample's worth of distance is a rounding artefact. A downsampled trace
  // whose first sample is 500 m in genuinely does not know what came before it, and
  // an invented origin would put 500 m in zero seconds inside the first window.
  it('leaves a genuinely late-starting axis alone', () => {
    const trace = traceFromStream({ t: [0, 60, 120], d: [500, 800, 1100] })!;
    expect(trace.d).toEqual([500, 800, 1100]);
  });
});

describe('paceOverWindow', () => {
  const trace = traceFromLaps(sundayLaps)!;

  it('answers about the stretch asked for, not the whole run', () => {
    expect(paceOverWindow(trace, 0, 2000)).toBe(300);       // the warm-up, 5:00
    expect(paceOverWindow(trace, 2000, 22000)).toBe(263);   // the block, 4:23
  });

  it('interpolates inside a lap', () => {
    // Half of the second 1 km lap, which was run at 5:00 like the first.
    expect(paceOverWindow(trace, 1000, 1500)).toBe(300);
  });

  it('refuses a window too short for GPS and lap placement to answer', () => {
    expect(paceOverWindow(trace, 2000, 2300)).toBeNull();
    expect(paceOverWindow(trace, 2000, 2000)).toBeNull();
  });

  it('refuses a window running off the end of the trace', () => {
    expect(paceOverWindow(trace, 20000, 40000)).toBeNull();
  });

  // A stop exactly on a boundary belongs to neither block. Inside one, it counts.
  it('starts the window when the athlete left the mark, not when they reached it', () => {
    const stopped = traceFromLaps([
      lap(1000, 300),
      lap(0, 120),        // two minutes standing at the 1 km mark
      lap(1000, 240),
    ])!;
    expect(paceOverWindow(stopped, 1000, 2000)).toBe(240);
    expect(paceOverWindow(stopped, 0, 2000)).toBe(330); // the stop is inside, so it counts
  });
});

describe('bestWindow', () => {
  const trace = traceFromLaps(sundayLaps)!;

  it('finds the 20 km the plan asked about', () => {
    const found = bestWindow(trace, 20000, 260, 270, 2000)!;
    expect(found.startM).toBe(2000);
    expect(found.endM).toBe(22000);
    expect(found.pace).toBe(263);
    expect(found.miss).toBe(0);
  });

  // A plan that says "8 km easy at 5:30" is not better served by the quickest 8 km.
  it('fits the band rather than running as fast as possible', () => {
    // 4 km at 4:00, then 4 km at 5:30.
    const mixed = traceFromLaps([
      ...Array.from({ length: 4 }, () => lap(1000, 240)),
      ...Array.from({ length: 4 }, () => lap(1000, 330)),
    ])!;
    expect(bestWindow(mixed, 2000, 325, 335)!.startM).toBe(4000);
    expect(bestWindow(mixed, 2000, 235, 245)!.startM).toBe(0);
  });

  it('reports how far off the band the closest window was', () => {
    const found = bestWindow(trace, 20000, 250, 255, 2000)!;
    expect(found.pace).toBe(263);
    expect(found.miss).toBe(8);
  });

  it('returns null when the run has no room for the block', () => {
    expect(bestWindow(trace, 30000, 260, 270)).toBeNull();
    expect(bestWindow(trace, 20000, 260, 270, 10000)).toBeNull();
  });
});

describe('plannedBlocks', () => {
  it('takes the paced stretches and leaves the strides to the rep finder', () => {
    const blocks = plannedBlocks(flattenPlannedSteps(SUNDAY));
    expect(blocks.map(b => [b.lengthM, b.paceMin, b.paceMax])).toEqual([
      [2000, 300, 330],
      [20000, 265, 265],
    ]);
  });

  // Written as five 1 km steps, it is still one 5 km block — and grading it as five
  // separate 1 km windows would reject each one as too short to answer.
  it('merges consecutive steps that share a band', () => {
    const blocks = plannedBlocks(flattenPlannedSteps(workout(
      Array.from({ length: 5 }, () => step({ durationValue: 1000, targetPaceMinPerKm: 270 })),
    )));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lengthM).toBe(5000);
  });

  /**
   * From production, 2026-08-25: the program's 5×(5 min at 3:25 / jog). The reps
   * share a band and the recoveries in between carry no pace, so skipping the
   * recoveries made the reps look consecutive and merged them into one 7.3 km
   * block — which was then graded over 7.3 km of the run WITH the jogs inside it
   * and reported at 4:28 against a 3:25 target. Thirteen athletes, one session.
   */
  it('does not merge reps across the recovery between them', () => {
    const blocks = plannedBlocks(flattenPlannedSteps(workout([
      step({
        repeatCount: 5,
        repeatSteps: [
          step({ type: 'interval', durationType: 'time', durationValue: 300, targetPaceMinPerKm: 205 }),
          step({ type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' }),
        ],
      }),
    ])));
    expect(blocks).toEqual([]);
  });

  // Same rule where the reps are measured rather than timed.
  it('does not merge distance reps across their recoveries either', () => {
    const blocks = plannedBlocks(flattenPlannedSteps(workout([
      step({ repeatCount: 5, repeatSteps: [
        step({ type: 'interval', durationValue: 2000, targetPaceMinPerKm: 245 }),
        step({ type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' }),
      ] }),
    ])));
    // Five 2 km reps, each its own block — not one 10 km block with four jogs in it.
    expect(blocks).toHaveLength(5);
    expect(blocks.every(b => b.lengthM === 2000)).toBe(true);
  });

  // A stretch written in time is judged on time. 6 min at 3:25 is 1756 m, which
  // would clear the distance floor — but it is a rep, and the rep finder counts it.
  it('judges a timed stretch on its duration, not on the metres it estimates to', () => {
    expect(plannedBlocks(flattenPlannedSteps(workout([
      step({ durationType: 'time', durationValue: 6 * 60, targetPaceMinPerKm: 205 }),
    ])))).toEqual([]);
    expect(plannedBlocks(flattenPlannedSteps(workout([
      step({ durationType: 'time', durationValue: 12 * 60, targetPaceMinPerKm: 205 }),
    ])))).toHaveLength(1);
  });

  it('keeps a progression run as separate blocks', () => {
    const blocks = plannedBlocks(flattenPlannedSteps(workout([
      step({ durationValue: 5000, targetPaceMinPerKm: 280 }),
      step({ durationValue: 5000, targetPaceMinPerKm: 260 }),
    ])));
    expect(blocks.map(b => b.paceMin)).toEqual([280, 260]);
  });

  it('places a long timed block through its target pace', () => {
    const blocks = plannedBlocks(flattenPlannedSteps(workout([
      step({ durationType: 'time', durationValue: 40 * 60, targetPaceMinPerKm: 300 }),
    ])));
    expect(blocks[0].lengthM).toBe(8000); // 40 min at 5:00
    expect(blocks[0].lengthEstimated).toBe(true);
  });

  it('has nothing to grade in a plan with no pace target', () => {
    expect(plannedBlocks(flattenPlannedSteps(workout([
      step({ durationValue: 8000, targetType: 'no_target' }),
    ])))).toEqual([]);
  });
});

describe('gradeWorkoutBlocks', () => {
  /**
   * The headline. Whole-run average 4:34 against a 4:25 target is 'slower', and five
   * of the seven athletes who ran this session were told exactly that. The 20 km
   * they were asked to run at 4:25 was run at 4:23.
   */
  it('grades the Sunday session on its block instead of its average', () => {
    const trace = traceFromLaps(sundayLaps)!;

    // What the athlete was told. `computeGradedPaceBand` grades an average only when
    // one band covers ≥90% of the plan, and 20 km of 22 km is 90.9% — so the guard
    // let this session through and then judged 4:34 against 4:25. Graded here at the
    // ±5 s/km that was in force the day this was found, so the case keeps stating the
    // bug: the average is wrong about the run whatever the tolerance is, and only the
    // size of the deviation it takes to misfire moved when the default widened to ±10.
    const average = assessWorkout(buildPlannedWorkout(workout([
      step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 }),
      step({ durationValue: 20000, targetPaceMinPerKm: 265, targetPaceMaxPerKm: 265 }),
    ]), '2026-09-06'), {
      id: 'act-1',
      date: '2026-09-06',
      distance: 23160,
      duration: 6340,
      averagePace: 274,
    }, { distance: 0.15, duration: 0.15, paceSec: 5 });
    expect(average.pace.comparedMin).toBe(265);
    expect(average.pace.status).toBe('slower');

    const report = gradeWorkoutBlocks(SUNDAY, trace);
    expect(report.blocks.map(b => [b.actualPace, b.status])).toEqual([
      [300, 'on_target'],
      [263, 'on_target'],
    ]);
    expect(report.onTargetCount).toBe(2);
    expect(report.gradedCount).toBe(2);
    expect(report.blocks[1].window).toMatchObject({ startM: 2000, endM: 22000 });
  });

  it('still says slower when the block itself was slower', () => {
    // Guy Joselson's run: same session, block at 4:33. Eight seconds per km off a
    // 4:25 band is inside the ±10 s/km tolerance, so his block is a pass…
    const guy = traceFromLaps([
      ...Array.from({ length: 2 }, () => lap(1000, 310)),
      ...Array.from({ length: 20 }, () => lap(1000, 273)),
    ])!;
    const guyReport = gradeWorkoutBlocks(SUNDAY, guy);
    expect(guyReport.blocks[1].actualPace).toBe(273);
    expect(guyReport.blocks[1].status).toBe('on_target');

    // …but a block genuinely off the band still reads slower: 4:45 against 4:25.
    const slow = traceFromLaps([
      ...Array.from({ length: 2 }, () => lap(1000, 310)),
      ...Array.from({ length: 20 }, () => lap(1000, 285)),
    ])!;
    const report = gradeWorkoutBlocks(SUNDAY, slow);
    expect(report.blocks[1].actualPace).toBe(285);
    expect(report.blocks[1].status).toBe('slower');
    expect(report.onTargetCount).toBe(1);
  });

  // An athlete who warms up for 2.4 km has not missed the session, and the block
  // must be found at the offset they actually ran it.
  it('finds the block after a longer warmup than planned', () => {
    const trace = traceFromLaps([
      ...Array.from({ length: 3 }, () => lap(1000, 300)),
      ...Array.from({ length: 20 }, () => lap(1000, 263)),
    ])!;
    const report = gradeWorkoutBlocks(SUNDAY, trace);
    expect(report.blocks[1].window!.startM).toBe(3000);
    expect(report.blocks[1].status).toBe('on_target');
  });

  it('searches each block forward of the last, so one stretch cannot serve two blocks', () => {
    // 5 km at 4:20 then 5 km at 5:00 — the hard part first.
    const plan = workout([
      step({ durationValue: 5000, targetPaceMinPerKm: 260 }),
      step({ durationValue: 5000, targetPaceMinPerKm: 300 }),
    ]);
    // Run with a kilometre of easy running slipped in at the front.
    const trace = traceFromLaps([
      lap(1000, 300),
      ...Array.from({ length: 5 }, () => lap(1000, 260)),
      ...Array.from({ length: 5 }, () => lap(1000, 300)),
    ])!;
    const report = gradeWorkoutBlocks(plan, trace);
    // The fast block is found where it was run, one kilometre in…
    expect(report.blocks[0].window!.startM).toBe(1000);
    // …and the easy block is what follows it, not the kilometre before it.
    expect(report.blocks[1].window!.startM).toBe(6000);
    expect(report.blocks.map(b => b.status)).toEqual(['on_target', 'on_target']);
  });

  /**
   * The bug this constraint exists for, from production. yair Gabbay's Sunday: a
   * 2 km warm-up at 5:00–5:30, then 20 km at 4:25. He jogged the last 2 km home at
   * 5:04, and an unbounded search located the WARM-UP there — a perfect band fit
   * 23 km into the run — after which the 20 km block that was the actual session
   * had no run left to be graded over and came back 'unknown'.
   */
  it('will not place a block so late that the blocks after it cannot fit', () => {
    const trace = traceFromLaps([
      ...Array.from({ length: 2 }, () => lap(1000, 290)),  // warm-up, a bit quick
      ...Array.from({ length: 20 }, () => lap(1000, 263)), // the block
      ...Array.from({ length: 2 }, () => lap(1000, 304)),  // jog home, a perfect
      //                                                      fit for the warm-up band
    ])!;
    const report = gradeWorkoutBlocks(SUNDAY, trace);
    expect(report.blocks[0].window!.startM).toBe(0);
    expect(report.blocks[1].window).toMatchObject({ startM: 2000, endM: 22000 });
    expect(report.blocks[1].actualPace).toBe(263);
    expect(report.blocks[1].status).toBe('on_target');
  });

  // "Warmed up a kilometre longer" is a plausible story; "started the session eight
  // kilometres in" is not, and grading it as though they had rewards running the
  // wrong session.
  it('does not let a block drift arbitrarily far from where the plan put it', () => {
    const plan = workout([step({ durationValue: 5000, targetPaceMinPerKm: 260 })]);
    const trace = traceFromLaps([
      ...Array.from({ length: 8 }, () => lap(1000, 330)),
      ...Array.from({ length: 5 }, () => lap(1000, 260)),
    ])!;
    const report = gradeWorkoutBlocks(plan, trace);
    expect(report.blocks[0].window!.startM).toBeLessThanOrEqual(1250);
    expect(report.blocks[0].status).toBe('slower');
  });

  // Cutting a session short is a real answer, not an absent one: 14 km at 4:23 tells
  // the coach more than 'unknown', and the pace is honestly over what was covered.
  it('grades what was covered when the run ended early, and says so', () => {
    const trace = traceFromLaps([
      ...Array.from({ length: 2 }, () => lap(1000, 300)),
      ...Array.from({ length: 12 }, () => lap(1000, 263)),
    ])!;
    const report = gradeWorkoutBlocks(SUNDAY, trace);
    expect(report.blocks[1].truncated).toBe(true);
    expect(report.blocks[1].window).toMatchObject({ startM: 2000, endM: 14000 });
    expect(report.blocks[1].status).toBe('on_target');
    expect(report.blocks[1].plannedLengthM).toBe(20000);
  });

  // Same case from a stream instead of laps, which is where it used to fail. A run
  // this far short of the plan leaves the search no slack, so every window is pinned
  // to metre 0 — and a stream whose first sample sits at 3 m had nothing there, so
  // all three of the warm-up, the block and the truncated fallback came back 'not
  // found' on a clean 1 Hz trace. Two of 2026-09-06's seventeen runs, both of them
  // exactly the "how far did they get" question a coach wants answered.
  it('grades an early-ended run from a stream whose first sample is not at zero', () => {
    const t: number[] = [];
    const d: number[] = [];
    let seconds = 0;
    for (let metres = 3; metres <= 13000; metres += 100) {
      t.push(Math.round(seconds));
      d.push(metres);
      seconds += metres < 2000 ? 30 : 28.5;   // 5:00/km warm-up, then 4:45/km
    }
    const report = gradeWorkoutBlocks(SUNDAY, traceFromStream({ t, d }));
    expect(report.blocks[0].window).toMatchObject({ startM: 0 });
    expect(report.blocks[0].status).toBe('on_target');
    expect(report.blocks[1].truncated).toBe(true);
    expect(report.blocks[1].actualPace).toBe(285);
    expect(report.blocks[1].status).toBe('slower');
  });

  it('reports why it could not grade, rather than a wrong colour', () => {
    expect(gradeWorkoutBlocks(SUNDAY, null).reason).toBe('no_trace');
    expect(gradeWorkoutBlocks(workout([step({ durationValue: 8000, targetType: 'no_target' })]),
      traceFromLaps(sundayLaps)).reason).toBe('no_blocks');
  });

  it('carries the evidence resolution through, so a caller can weigh it', () => {
    expect(gradeWorkoutBlocks(SUNDAY, traceFromLaps(sundayLaps)).resolutionM).toBe(1000);
  });
});

/**
 * One block, for a card with room for one pace number and a feed badge with room for
 * one colour. Every case here is a false verdict the production replay produced.
 */
describe('dominantBlock', () => {
  it('is the paced block, not the warm-up in front of it', () => {
    const report = gradeWorkoutBlocks(SUNDAY, traceFromLaps(sundayLaps));
    expect(dominantBlock(report)).toMatchObject({ plannedLengthM: 20000, actualPace: 263 });
  });

  // The warm-up is not the session even when it is the longer of the two.
  it('will not pick a warm-up over a shorter block of work', () => {
    const plan = workout([
      step({ type: 'warmup', durationValue: 6000, targetPaceMinPerKm: 320, targetPaceMaxPerKm: 350 }),
      step({ durationValue: 3000, targetPaceMinPerKm: 240, targetPaceMaxPerKm: 245 }),
    ]);
    const trace = traceFromLaps([
      ...Array.from({ length: 6 }, () => lap(1000, 335)),
      ...Array.from({ length: 3 }, () => lap(1000, 242)),
    ])!;
    expect(dominantBlock(gradeWorkoutBlocks(plan, trace))).toMatchObject({ plannedLengthM: 3000 });
  });

  /**
   * From production, 2026-08-25: the program's 5×(5 min at 3:25) off a 3 km warm-up
   * written at 4:40. The reps are the rep finder's business, which leaves the warm-up
   * as the only block — and eleven athletes who warmed up between 4:55 and 6:16 would
   * have been badged "slower than target" for the jog before their workout.
   */
  it('has no verdict for an interval day, rather than judging the warm-up jog', () => {
    const plan = workout([
      step({ type: 'warmup', durationValue: 3000, targetPaceMinPerKm: 280 }),
      step({ repeatCount: 5, repeatSteps: [
        step({ type: 'interval', durationType: 'time', durationValue: 300, targetPaceMinPerKm: 205 }),
        step({ type: 'recovery', durationType: 'time', durationValue: 120, targetType: 'no_target' }),
      ] }),
    ]);
    const trace = traceFromLaps([
      ...Array.from({ length: 3 }, () => lap(1000, 350)),   // warm-up at 5:50
      ...Array.from({ length: 5 }, () => [lap(1450, 300), lap(400, 120)]).flat(),
    ])!;
    const report = gradeWorkoutBlocks(plan, trace);
    expect(report.blocks).toHaveLength(1);          // the warm-up is still reported…
    expect(report.blocks[0].status).toBe('slower'); // …and honestly graded…
    expect(dominantBlock(report)).toBeNull();       // …but it is not the verdict.
  });

  // A block the run ended in the middle of is the distance verdict's story, not the
  // pace verdict's — and its window runs to the end of the file, so a jog home is in it.
  it('has no verdict from a block the athlete did not finish', () => {
    const cutShort = traceFromLaps([
      ...Array.from({ length: 2 }, () => lap(1000, 300)),
      ...Array.from({ length: 12 }, () => lap(1000, 263)),
    ])!;
    const report = gradeWorkoutBlocks(SUNDAY, cutShort);
    expect(report.blocks[1].truncated).toBe(true);
    expect(dominantBlock(report)).toBeNull();
  });

  it('takes the longest of several blocks of work', () => {
    const plan = workout([
      step({ durationValue: 4000, targetPaceMinPerKm: 280 }),
      step({ durationValue: 8000, targetPaceMinPerKm: 300 }),
    ]);
    const trace = traceFromLaps([
      ...Array.from({ length: 4 }, () => lap(1000, 282)),
      ...Array.from({ length: 8 }, () => lap(1000, 301)),
    ])!;
    expect(dominantBlock(gradeWorkoutBlocks(plan, trace))!.plannedLengthM).toBe(8000);
  });

  it('has nothing to say about a run with no trace', () => {
    expect(dominantBlock(gradeWorkoutBlocks(SUNDAY, null))).toBeNull();
  });
});

describe('findPlannedEfforts with time-based reps', () => {
  it('finds the eight 15-second strides', () => {
    const report = findPlannedEfforts(flattenPlannedSteps(SUNDAY), sundayLaps);
    const strides = report.requirements.find(r => r.durationSec === 15)!;
    expect(strides.matchBy).toBe('duration');
    expect(strides.needed).toBe(8);
    expect(strides.attempted).toBe(8);
    expect(strides.verifiable).toBe(true);
  });

  /**
   * The reason this matches on time. A 15-second stride converted to metres through
   * its 3:20 target is 75 m; an athlete who ran the strides at 4:10 covered 60 m,
   * which is outside ±20% of 75 and was reported as never run. They ran all eight.
   */
  it('finds a timed rep that was run off pace, because it is still 15 seconds long', () => {
    const offPace: Lap[] = [
      ...Array.from({ length: 2 }, () => lap(1000, 300)),
      ...Array.from({ length: 20 }, () => lap(1000, 263)),
      ...Array.from({ length: 8 }, () => [lap(60, 15), lap(62, 45)]).flat(),
    ];
    const report = findPlannedEfforts(flattenPlannedSteps(SUNDAY), offPace);
    const strides = report.requirements.find(r => r.durationSec === 15)!;
    expect(strides.attempted).toBe(8);   // the work happened
    expect(strides.found).toBe(0);       // at the wrong pace
    expect(report.verdict).toBe('partial');
  });

  // Where duration alone is not enough to tell a rep from its recovery, pace still is.
  it('does not credit an equal-length recovery as a rep', () => {
    const plan = workout([
      step({
        repeatCount: 6,
        repeatSteps: [
          step({ type: 'interval', durationType: 'time', durationValue: 60, targetPaceMinPerKm: 220 }),
          step({ type: 'recovery', durationType: 'time', durationValue: 60, targetType: 'no_target' }),
        ],
      }),
    ]);
    const laps = Array.from({ length: 6 }, () => [lap(273, 60), lap(150, 60)]).flat();
    const report = findPlannedEfforts(plan.steps.length ? flattenPlannedSteps(plan) : [], laps);
    const reps = report.requirements.find(r => r.durationSec === 60)!;
    expect(reps.needed).toBe(6);
    expect(reps.attempted).toBe(6);
    expect(reps.paces.every(p => p < 250)).toBe(true);
  });

  it('still matches a distance rep on distance', () => {
    const plan = workout([
      step({ repeatCount: 6, repeatSteps: [
        step({ type: 'interval', durationValue: 400, targetPaceMinPerKm: 235, targetPaceMaxPerKm: 245 }),
        step({ type: 'recovery', durationType: 'time', durationValue: 90, targetType: 'no_target' }),
      ] }),
    ]);
    const laps = Array.from({ length: 6 }, () => [lap(400, 96), lap(200, 90)]).flat();
    const report = findPlannedEfforts(flattenPlannedSteps(plan), laps);
    const reps = report.requirements[0];
    expect(reps.matchBy).toBe('distance');
    expect(reps.found).toBe(6);
    expect(report.verdict).toBe('confirmed');
  });
});
