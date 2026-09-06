import { describe, it, expect } from 'vitest';
import {
  buildPlannedBands,
  effortRequirements,
  findPlannedEfforts,
  flattenPlannedSteps,
  matchLapsToSteps,
  projectBandsToBins,
  type Lap,
} from '@/lib/academy/segments';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The per-segment grader. This is where a structured session actually gets
// judged — the adherence engine deliberately returns 'unknown' on pace for an
// interval workout and defers the question here, so these verdicts are the only
// answer an athlete gets to "did I hit my intervals?".

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    stepOrder: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[]): ParsedWorkout {
  return { name: 'W', dayOfWeek: 0, steps } as ParsedWorkout;
}

/** 2 km warmup, 4×(400 m interval + 200 m recovery), 1 km cooldown. */
function intervalSession(): ParsedWorkout {
  return workout([
    step({ type: 'warmup', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 330, targetPaceMaxPerKm: 340 }),
    step({
      durationType: 'open',
      repeatCount: 4,
      repeatSteps: [
        step({ type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 240, targetPaceMaxPerKm: 240 }),
        step({ type: 'recovery', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 420, targetPaceMaxPerKm: 420 }),
      ],
    }),
    step({ type: 'cooldown', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 360, targetPaceMaxPerKm: 360 }),
  ]);
}

describe('flattenPlannedSteps', () => {
  it('expands repeats into the order they are actually run', () => {
    const flat = flattenPlannedSteps(intervalSession());
    expect(flat).toHaveLength(10); // warmup + 4×(interval+recovery) + cooldown
    expect(flat.map(s => s.type)).toEqual([
      'warmup',
      'interval', 'recovery', 'interval', 'recovery',
      'interval', 'recovery', 'interval', 'recovery',
      'cooldown',
    ]);
    // Indices are the run order, not the position within the source step tree.
    expect(flat.map(s => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('grades paced work steps and never the rests', () => {
    const flat = flattenPlannedSteps(intervalSession());
    expect(flat.filter(s => s.graded).map(s => s.type)).toEqual(
      ['warmup', 'interval', 'interval', 'interval', 'interval', 'cooldown'],
    );
    // The recoveries carry a pace target and are still not graded — jogging a
    // recovery slower than written is not a missed workout.
    expect(flat.filter(s => s.type === 'recovery').every(s => s.graded === false)).toBe(true);
  });

  it('does not grade a step with no pace target', () => {
    const [only] = flattenPlannedSteps(workout([step({ targetType: 'no_target' })]));
    expect(only.graded).toBe(false);
  });

  it('mirrors a single pace into both bounds', () => {
    const [only] = flattenPlannedSteps(
      workout([step({ targetType: 'pace', targetPaceMinPerKm: 300 })]),
    );
    expect(only.paceMin).toBe(300);
    expect(only.paceMax).toBe(300);
  });

  it('labels a step by what it is and how long', () => {
    const labels = flattenPlannedSteps(workout([
      step({ type: 'interval', durationValue: 400 }),
      step({ type: 'warmup', durationValue: 2000 }),
      step({ type: 'active', durationValue: 1500 }),
      step({ type: 'active', durationType: 'time', durationValue: 1800 }),
      step({ type: 'rest', durationType: 'open' }),
    ])).map(s => s.label);
    expect(labels).toEqual(['Interval 400m', 'Warmup 2km', 'Run 1.5km', 'Run 30min', 'Rest']);
  });
});

describe('matchLapsToSteps', () => {
  const flat = () => flattenPlannedSteps(intervalSession());

  /** A lap the watch would record for a step run exactly to plan. */
  const lap = (distance: number, paceSecPerKm: number): Lap => ({
    distance,
    duration: Math.round((distance / 1000) * paceSecPerKm),
  });

  function lapsExactlyToPlan(): Lap[] {
    return [
      lap(2000, 335),
      lap(400, 240), lap(200, 420), lap(400, 240), lap(200, 420),
      lap(400, 240), lap(200, 420), lap(400, 240), lap(200, 420),
      lap(1000, 360),
    ];
  }

  it('grades every paced step when the laps line up', () => {
    const r = matchLapsToSteps(flat(), lapsExactlyToPlan());
    expect(r.aligned).toBe(true);
    expect(r.gradedCount).toBe(6);
    expect(r.onTargetCount).toBe(6);
    expect(r.reason).toBeUndefined();
  });

  it('calls out only the interval that was missed', () => {
    const laps = lapsExactlyToPlan();
    laps[5] = lap(400, 265); // third interval 25 s/km slow
    const r = matchLapsToSteps(flat(), laps);
    expect(r.onTargetCount).toBe(5);
    expect(r.segments[5].status).toBe('slower');
    expect(r.segments[1].status).toBe('on_target');
  });

  it('marks an interval run faster than the band, not just slower', () => {
    const laps = lapsExactlyToPlan();
    laps[1] = lap(400, 210);
    expect(matchLapsToSteps(flat(), laps).segments[1].status).toBe('faster');
  });

  it('leaves rests ungraded even when the lap is nowhere near the written pace', () => {
    const laps = lapsExactlyToPlan();
    laps[2] = lap(200, 600); // walked the recovery
    const r = matchLapsToSteps(flat(), laps);
    expect(r.segments[2].graded).toBe(false);
    expect(r.segments[2].status).toBe('unknown');
    expect(r.onTargetCount).toBe(6); // untouched
  });

  it('derives a lap pace when the watch did not report one', () => {
    const r = matchLapsToSteps(flat(), lapsExactlyToPlan());
    expect(r.segments[1].actualPace).toBe(240); // 96 s over 400 m
  });

  it('prefers the reported lap pace over deriving one', () => {
    const laps = lapsExactlyToPlan();
    laps[1] = { ...laps[1], averagePace: 300 };
    expect(matchLapsToSteps(flat(), laps).segments[1].actualPace).toBe(300);
  });

  // ── Refusing to guess ──────────────────────────────────────────────────────
  it('grades nothing rather than mislabelling when the lap count is off', () => {
    // One extra lap — the athlete pressed stop late — and positional alignment
    // would shift every verdict by one, painting good intervals red.
    const laps = [...lapsExactlyToPlan(), lap(150, 500)];
    const r = matchLapsToSteps(flat(), laps);
    expect(r.aligned).toBe(false);
    expect(r.onTargetCount).toBe(0);
    expect(r.segments.every(s => s.status === 'unknown')).toBe(true);
    expect(r.segments.every(s => s.actualPace === null)).toBe(true);
    expect(r.reason).toBe('lap count (11) does not match planned steps (10)');
  });

  it('explains an unstructured run as missing lap data', () => {
    const r = matchLapsToSteps(flat(), []);
    expect(r.aligned).toBe(false);
    expect(r.reason).toContain('no lap data');
  });

  it('explains an empty plan as having no steps', () => {
    const r = matchLapsToSteps([], [lap(1000, 300)]);
    expect(r.aligned).toBe(false);
    expect(r.reason).toBe('no planned steps');
  });

  it('is not aligned when both sides are empty', () => {
    // Zero laps against zero steps is a vacuous match, not a graded workout.
    expect(matchLapsToSteps([], []).aligned).toBe(false);
  });

  it('still reports the planned band for a step it could not grade', () => {
    const r = matchLapsToSteps(flat(), []);
    expect(r.segments[1].plannedPaceMin).toBe(240);
    expect(r.segments[1].plannedPaceMax).toBe(240);
  });

  it('honours a caller\'s pace tolerance', () => {
    const laps = lapsExactlyToPlan();
    laps[1] = lap(400, 248); // 8 s/km slow
    expect(matchLapsToSteps(flat(), laps).segments[1].status).toBe('slower');
    expect(matchLapsToSteps(flat(), laps, 10).segments[1].status).toBe('on_target');
  });
});

describe('buildPlannedBands', () => {
  it('lays paced work out on a meter timeline, with rests advancing the cursor', () => {
    const bands = buildPlannedBands(intervalSession());
    // warmup 0–2000, then interval/recovery alternating 400/200, then cooldown.
    // The recoveries move the cursor but contribute no band.
    expect(bands).toEqual([
      { startM: 0, endM: 2000, min: 330, max: 340 },
      { startM: 2000, endM: 2400, min: 240, max: 240 },
      { startM: 2600, endM: 3000, min: 240, max: 240 },
      { startM: 3200, endM: 3600, min: 240, max: 240 },
      { startM: 3800, endM: 4200, min: 240, max: 240 },
      { startM: 4400, endM: 5400, min: 360, max: 360 },
    ]);
  });

  it('places a timed step by converting its target pace to meters', () => {
    // 30 min at 5:00/km → 6000 m.
    const bands = buildPlannedBands(workout([
      step({ durationType: 'time', durationValue: 1800, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 300 }),
    ]));
    expect(bands).toEqual([{ startM: 0, endM: 6000, min: 300, max: 300 }]);
  });

  it('emits nothing for a plan with no paced steps', () => {
    expect(buildPlannedBands(workout([step({ targetType: 'no_target' })]))).toEqual([]);
  });

  it('skips a step it cannot place on the timeline', () => {
    // Open-ended with no distance and no time: there is no honest length for it,
    // so it neither draws a band nor shifts what follows.
    const bands = buildPlannedBands(workout([
      step({ type: 'rest', durationType: 'open' }),
      step({ durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 300 }),
    ]));
    expect(bands).toEqual([{ startM: 0, endM: 1000, min: 300, max: 300 }]);
  });
});

describe('projectBandsToBins', () => {
  it('gives every bin a null when there is no plan to overlay', () => {
    expect(projectBandsToBins([], [1000, 1000])).toEqual([null, null]);
  });

  it('projects a single band straight onto matching bins', () => {
    const out = projectBandsToBins([{ startM: 0, endM: 2000, min: 300, max: 320 }], [1000, 1000]);
    expect(out).toEqual([
      { pace: 310, min: 300, max: 320 },
      { pace: 310, min: 300, max: 320 },
    ]);
  });

  it('weights a bin spanning two bands by how much of each it covers', () => {
    // The bin covers 500 m at 240 and 500 m at 340 → 290.
    const out = projectBandsToBins(
      [{ startM: 0, endM: 500, min: 240, max: 240 }, { startM: 500, endM: 1000, min: 340, max: 340 }],
      [1000],
    );
    expect(out).toEqual([{ pace: 290, min: 290, max: 290 }]);
  });

  it('breaks the overlay for a bin the plan barely covers', () => {
    // 400 m of a 1000 m bin — under half, so there is no value worth drawing.
    expect(projectBandsToBins([{ startM: 0, endM: 400, min: 240, max: 240 }], [1000])).toEqual([null]);
  });

  it('draws a bin covered exactly half way', () => {
    const out = projectBandsToBins([{ startM: 0, endM: 500, min: 240, max: 240 }], [1000]);
    expect(out).toEqual([{ pace: 240, min: 240, max: 240 }]);
  });

  it('handles uneven auto-lap splits, which is the case it exists for', () => {
    // An interval workout auto-laps per step: 630 m fast, 131 m slow.
    const out = projectBandsToBins(
      [{ startM: 0, endM: 630, min: 240, max: 240 }, { startM: 761, endM: 1391, min: 240, max: 240 }],
      [630, 131, 630],
    );
    expect(out[0]).toEqual({ pace: 240, min: 240, max: 240 });
    expect(out[1]).toBeNull(); // the recovery has no paced band over it
    expect(out[2]).toEqual({ pace: 240, min: 240, max: 240 });
  });

  it('never puts NaN in the overlay for a zero-width bin', () => {
    // A zero-width bin passes `covered >= width * 0.5` with nothing covered, and
    // the weighted averages would divide 0 by 0.
    expect(projectBandsToBins([{ startM: 0, endM: 1000, min: 300, max: 300 }], [0])).toEqual([null]);
  });

  it('gives bins past the end of the plan a null', () => {
    const out = projectBandsToBins([{ startM: 0, endM: 1000, min: 300, max: 300 }], [1000, 1000]);
    expect(out[1]).toBeNull();
  });
});

// ── "Did they do the workout?" without the watch ────────────────────────────
// matchLapsToSteps above answers only for a run the watch drove. These tests pin
// the order-free fallback: find the planned efforts among the laps as a set, and
// never report "the laps can't show it" as "they didn't do it".

describe('effortRequirements', () => {
  /** 6×400 m at 3:55–4:05, nothing else paced. The shape most quality days take. */
  function repsOnly(reps = 6, distance = 400): ParsedWorkout {
    return workout([
      step({
        durationType: 'open',
        repeatCount: reps,
        repeatSteps: [
          step({ type: 'interval', durationValue: distance, targetType: 'pace', targetPaceMinPerKm: 235, targetPaceMaxPerKm: 245 }),
          step({ type: 'recovery', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 420 }),
        ],
      }),
    ]);
  }

  it('collapses a repeat into one requirement with a count', () => {
    const reqs = effortRequirements(flattenPlannedSteps(repsOnly()));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ distanceM: 400, paceMin: 235, paceMax: 245, needed: 6, found: 0 });
  });

  it('does not ask for the recoveries', () => {
    // They carry a pace target and are still not work — requiring them would fail
    // every athlete who jogs a recovery instead of running it.
    const reqs = effortRequirements(flattenPlannedSteps(repsOnly()));
    expect(reqs.some(r => r.distanceM === 200)).toBe(false);
  });

  it('keeps distinct lengths and bands apart', () => {
    const reqs = effortRequirements(flattenPlannedSteps(intervalSession()));
    expect(reqs.map(r => [r.distanceM, r.needed])).toEqual([[2000, 1], [400, 4], [1000, 1]]);
  });

  it('groups lengths that differ only by rounding', () => {
    // 400 and 402 are one requirement of two, not two of one.
    const reqs = effortRequirements(flattenPlannedSteps(workout([
      step({ type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 240 }),
      step({ type: 'interval', durationValue: 402, targetType: 'pace', targetPaceMinPerKm: 240 }),
    ])));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].needed).toBe(2);
  });

  it('converts a time-based rep to meters through its own target pace', () => {
    // "4 min at 4:00/km" is 1000 m of work — the watch recorded a distance either way.
    const reqs = effortRequirements(flattenPlannedSteps(workout([
      step({ type: 'interval', durationType: 'time', durationValue: 240, targetType: 'pace', targetPaceMinPerKm: 240 }),
    ])));
    expect(reqs[0].distanceM).toBe(1000);
  });

  it('does not turn a long timed block into a rep', () => {
    // "60 min at 4:40" is a steady run. Converting it gives a 12,973 m
    // requirement no lap can match; the whole-run pace grade answers it instead.
    const reqs = effortRequirements(flattenPlannedSteps(workout([
      step({ type: 'active', durationType: 'time', durationValue: 3600, targetType: 'pace', targetPaceMinPerKm: 275, targetPaceMaxPerKm: 280 }),
    ])));
    expect(reqs).toHaveLength(0);
  });

  it('still looks for a long rep the plan wrote in meters', () => {
    // A 5 km tempo is one effort, and 5000 is the coach's number, not an estimate.
    const reqs = effortRequirements(flattenPlannedSteps(workout([
      step({ type: 'interval', durationValue: 5000, targetType: 'pace', targetPaceMinPerKm: 240 }),
    ])));
    expect(reqs[0].distanceM).toBe(5000);
  });

  it('skips work with no placeable length', () => {
    const reqs = effortRequirements(flattenPlannedSteps(workout([
      step({ type: 'interval', durationType: 'open', durationValue: undefined, targetType: 'pace', targetPaceMinPerKm: 240 }),
    ])));
    expect(reqs).toHaveLength(0);
  });
});

describe('findPlannedEfforts', () => {
  const lap = (distance: number, paceSecPerKm: number): Lap => ({
    distance,
    duration: Math.round((distance / 1000) * paceSecPerKm),
  });

  function repsOnly(reps = 6): ParsedWorkout {
    return workout([
      step({
        durationType: 'open',
        repeatCount: reps,
        repeatSteps: [
          step({ type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 235, targetPaceMaxPerKm: 245 }),
          step({ type: 'recovery', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 420 }),
        ],
      }),
    ]);
  }
  const reps = () => flattenPlannedSteps(repsOnly());

  /** Six reps lapped by hand, warmup and cooldown each one lap, plus a stray press. */
  function offWatchLaps(): Lap[] {
    return [
      lap(2050, 335),
      lap(400, 240), lap(400, 238), lap(400, 242), lap(400, 240),
      lap(1050, 358),
      lap(300, 500),
    ];
  }

  it('confirms the work even though the lap count cannot align', () => {
    const flat = flattenPlannedSteps(intervalSession());
    // Positional grading gives up on these laps — 7 against 10 planned steps.
    expect(matchLapsToSteps(flat, offWatchLaps()).aligned).toBe(false);
    const r = findPlannedEfforts(flat, offWatchLaps());
    expect(r.verdict).toBe('confirmed');
    expect(r.neededTotal).toBe(6);
    expect(r.foundTotal).toBe(6);
    expect(r.reason).toBeUndefined();
  });

  it('does not care what order the efforts came in', () => {
    const flat = flattenPlannedSteps(intervalSession());
    const shuffled = [offWatchLaps()[5], ...offWatchLaps().slice(1, 5), offWatchLaps()[0], offWatchLaps()[6]];
    expect(findPlannedEfforts(flat, shuffled).verdict).toBe('confirmed');
  });

  it('reports the paces that satisfied a requirement in run order', () => {
    // Not in band order: the closest-to-target one is picked first internally and
    // must come back in the order the athlete actually ran them.
    const r = findPlannedEfforts(reps(), [
      { ...lap(2000, 400), averagePace: 400 },
      { ...lap(400, 244), averagePace: 244 },
      { ...lap(400, 236), averagePace: 236 },
      { ...lap(400, 240), averagePace: 240 },
    ]);
    expect(r.requirements[0].paces).toEqual([244, 236, 240]);
  });

  it('spends each lap once, so one fast kilometre is not six reps', () => {
    const r = findPlannedEfforts(reps(), [lap(400, 240), lap(3000, 330)]);
    expect(r.foundTotal).toBe(1);
    expect(r.requirements[0].paces).toHaveLength(1);
    expect(r.verdict).toBe('partial');
  });

  it('counts a partial set as partial', () => {
    const r = findPlannedEfforts(reps(), [
      lap(400, 240), lap(400, 238), lap(400, 242), lap(400, 241),
      lap(400, 290), lap(400, 295), // last two well off the back
    ]);
    expect(r.verdict).toBe('partial');
    expect(r.foundTotal).toBe(4);
    expect(r.neededTotal).toBe(6);
  });

  it('counts a rep run off pace as run, not as skipped', () => {
    // Six 400s a good 55 s/km slow. The work happened — that is a different
    // conversation from not turning up, and 'missed' would say the wrong one.
    const r = findPlannedEfforts(reps(), Array.from({ length: 6 }, () => lap(400, 300)));
    expect(r.verdict).toBe('partial');
    expect(r.attemptedTotal).toBe(6);
    expect(r.foundTotal).toBe(0);
    expect(r.requirements[0].verifiable).toBe(true);
  });

  it('credits a rep run faster than the band', () => {
    // A descending ladder run harder than written all the way down. Every rep was
    // run; none is 'in band'; calling that a miss is just wrong.
    const r = findPlannedEfforts(reps(), Array.from({ length: 6 }, () => lap(400, 200)));
    expect(r.attemptedTotal).toBe(6);
    expect(r.foundTotal).toBe(0);
    expect(r.verdict).toBe('partial');
  });

  it('calls it missed only when no rep was run at all', () => {
    // Right length, walked — past any plausible rep pace, so nothing is credited.
    const r = findPlannedEfforts(reps(), Array.from({ length: 6 }, () => lap(400, 700)));
    expect(r.verdict).toBe('missed');
    expect(r.attemptedTotal).toBe(0);
    expect(r.requirements[0].verifiable).toBe(true);
  });

  it('does not count the recovery jogs as reps when they are the same length', () => {
    // 10×200 with 200 m recoveries: every recovery lap is exactly rep-length, and
    // crediting by distance alone would report 10/10 for five reps and five jogs.
    const flat = flattenPlannedSteps(workout([
      step({
        durationType: 'open',
        repeatCount: 10,
        repeatSteps: [
          step({ type: 'interval', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 190 }),
          step({ type: 'recovery', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 420 }),
        ],
      }),
    ]));
    const laps: Lap[] = [];
    for (let i = 0; i < 5; i++) { laps.push(lap(200, 190)); laps.push(lap(200, 430)); }
    const r = findPlannedEfforts(flat, laps);
    expect(r.attemptedTotal).toBe(5);
    expect(r.foundTotal).toBe(5);
    expect(r.neededTotal).toBe(10);
    expect(r.verdict).toBe('partial');
  });

  it('honours a caller\'s pace tolerance', () => {
    const laps = [lap(400, 253), lap(400, 253)]; // 8 s/km off the slow edge
    expect(findPlannedEfforts(reps(), laps).foundTotal).toBe(0);
    expect(findPlannedEfforts(reps(), laps, 10).foundTotal).toBe(2);
  });

  it('accepts a rep the athlete overran or cut short by up to a fifth', () => {
    const r = findPlannedEfforts(reps(), [lap(470, 240), lap(335, 240)]);
    expect(r.foundTotal).toBe(2);
  });

  // ── Refusing to accuse ─────────────────────────────────────────────────────
  it('says the laps are too coarse rather than that the work was skipped', () => {
    // Nobody pressed lap, so the watch auto-lapped per kilometre. No 400 m rep is
    // visible in those at any pace — this must not read as a missed workout.
    const r = findPlannedEfforts(reps(), Array.from({ length: 5 }, () => lap(1000, 240)));
    expect(r.verdict).toBe('unverifiable');
    expect(r.reason).toBe('laps_too_coarse');
    expect(r.medianLapM).toBe(1000);
    expect(r.requirements[0].verifiable).toBe(false);
  });

  it('leaves a requirement no lap could show unverifiable, and grades the rest', () => {
    // 4×400 lapped by hand; the 2 km warmup and 1 km cooldown ran on the same lap.
    const flat = flattenPlannedSteps(intervalSession());
    const r = findPlannedEfforts(flat, [
      lap(3050, 400),
      lap(400, 240), lap(400, 240), lap(400, 240), lap(400, 240),
    ]);
    expect(r.verdict).toBe('confirmed');
    expect(r.neededTotal).toBe(4); // only the reps could be checked
    expect(r.foundTotal).toBe(4);
    expect(r.requirements.filter(x => !x.verifiable).map(x => x.distanceM)).toEqual([2000, 1000]);
  });

  it('credits an ambiguous lap to the longer rep', () => {
    // A 900 m lap is a plausible 800 at ±20% too; letting the 800 take it would
    // leave the real 1000 with nothing.
    const flat = flattenPlannedSteps(workout([
      step({ type: 'interval', durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 200 }),
      step({ type: 'interval', durationValue: 800, targetType: 'pace', targetPaceMinPerKm: 200 }),
    ]));
    const r = findPlannedEfforts(flat, [lap(2000, 400), lap(900, 200)]);
    expect(r.requirements.find(x => x.distanceM === 1000)?.found).toBe(1);
    expect(r.requirements.find(x => x.distanceM === 800)?.verifiable).toBe(false);
  });

  it('says there is nothing to check when the plan sets no pace', () => {
    const r = findPlannedEfforts(flattenPlannedSteps(workout([step()])), [lap(1000, 300), lap(1000, 300)]);
    expect(r.verdict).toBe('unverifiable');
    expect(r.reason).toBe('no_paced_plan');
  });

  it('says there is nothing to compare when the whole run is one lap', () => {
    const r = findPlannedEfforts(reps(), [lap(8000, 280)]);
    expect(r.verdict).toBe('unverifiable');
    expect(r.reason).toBe('no_laps');
    expect(r.lapCount).toBe(1);
  });

  it('ignores laps with no distance or no derivable pace', () => {
    const r = findPlannedEfforts(reps(), [
      { distance: 0, duration: 30 },
      { distance: 400, duration: 0 },
      lap(400, 240),
    ]);
    expect(r.reason).toBe('no_laps'); // only one usable lap of the three
    expect(r.lapCount).toBe(3);
  });
});
