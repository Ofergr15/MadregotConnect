import { describe, expect, it } from 'vitest';
import {
  ASSUMED_PACE,
  easyPaceBand,
  isEstimate,
  minutesRangeFromNotes,
  paceRangeFromNotes,
  planEstimateOptions,
  stepDistanceRange,
  stepPaceBand,
  stepTimeRange,
  weakest,
  workoutDistanceEstimate,
  workoutTimeEstimate,
} from '@/lib/plans/step-estimate';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The cases below are the real sessions from the week of 2026-09-06, copied off
// `weekly_plans.parsed_workouts`. Two of the nine state a time and no distance,
// and one has its stated range collapsed to a midpoint — which is the whole
// reason this module exists, so the fixtures are the plan and not inventions.

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'time',
    durationValue: 600,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[], over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return { dayOfWeek: 0, name: 'Run', steps, ...over } as ParsedWorkout;
}

/** Monday: "60 דק׳ 4:50-5:30", one hour, coach says 11–13 km. */
const MONDAY = step({
  durationType: 'time', durationValue: 3600, notes: '60 דק׳ 4:50-5:30',
  targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330,
});

/** Monday evening: no distance, no time field, no pace. Everything is prose. */
const MONDAY_EVENING = step({
  durationType: 'open', durationValue: undefined,
  notes: 'אופציה ל30-40 דק׳ קל בערב / כוח',
});

/** Wednesday: "70-80 דק׳ ריצת שחרור קלה", open-ended, no pace. */
const WEDNESDAY = step({
  durationType: 'open', durationValue: undefined, notes: '70-80 דק׳ ריצת שחרור קלה',
});

/** Saturday: the coach wrote 40-50 minutes; the parser stored 45. */
const SATURDAY = step({
  durationType: 'time', durationValue: 2700, notes: '40-50 דק׳ 4:50-5:30',
  targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330,
});

describe('minutesRangeFromNotes', () => {
  it('reads a range and a single figure', () => {
    expect(minutesRangeFromNotes('70-80 דק׳ ריצת שחרור קלה')).toEqual({ min: 4200, max: 4800 });
    expect(minutesRangeFromNotes('60 דק׳ 4:50-5:30')).toEqual({ min: 3600, max: 3600 });
    expect(minutesRangeFromNotes('אופציה ל30-40 דק׳ קל בערב / כוח')).toEqual({ min: 1800, max: 2400 });
  });

  it('finds nothing in a note that states no minutes', () => {
    expect(minutesRangeFromNotes('5 × 20 שניות מתגברת')).toBeNull();
    expect(minutesRangeFromNotes('הליכה')).toBeNull();
    expect(minutesRangeFromNotes(undefined)).toBeNull();
  });

  it('rejects a backwards range rather than inverting the estimate', () => {
    expect(minutesRangeFromNotes('80-70 דקות')).toBeNull();
  });
});

describe('paceRangeFromNotes', () => {
  it('reads the club notation', () => {
    expect(paceRangeFromNotes('4:50-5:30')).toEqual({ min: 290, max: 330 });
    expect(paceRangeFromNotes('3:30 לא מהר מזה!')).toEqual({ min: 210, max: 210 });
  });

  it('refuses a time that cannot be a pace', () => {
    // A stride set, not a fifteen-second kilometre.
    expect(paceRangeFromNotes('8 × 0:15 מתגברת')).toBeNull();
    // And nobody runs a kilometre in 12 minutes on a plan like this one.
    expect(paceRangeFromNotes('12:00')).toBeNull();
  });
});

describe('stepPaceBand', () => {
  it('takes the step\'s own band', () => {
    expect(stepPaceBand(MONDAY)).toEqual({ range: { min: 290, max: 330 }, from: 'measured' });
  });

  it('treats a one-sided pace as one pace, not a range', () => {
    // With a bare fallback for the missing side, a step prescribed at 6:40/km
    // got a max of 6:00/km — a max faster than its min, which inverts the
    // distance range and reports min > max.
    expect(stepPaceBand(step({ targetPaceMinPerKm: 400 })).range).toEqual({ min: 400, max: 400 });
    expect(stepPaceBand(step({ targetPaceMaxPerKm: 400 })).range).toEqual({ min: 400, max: 400 });
  });

  it('falls back to the note when the fields are empty', () => {
    expect(stepPaceBand(step({ notes: '4:50-5:30' })))
      .toEqual({ range: { min: 290, max: 330 }, from: 'stated' });
  });

  it('prices a walking rest slower than a run', () => {
    // One band for everything credited the 45-second "הליכה" between strides
    // with running distance.
    expect(stepPaceBand(step({ type: 'rest' })).range).toEqual(ASSUMED_PACE.recovery);
    expect(stepPaceBand(step({ type: 'active' })).range).toEqual(ASSUMED_PACE.running);
  });

  it('uses the week\'s own easy band when given one', () => {
    expect(stepPaceBand(step(), { easyBand: { min: 290, max: 330 } }))
      .toEqual({ range: { min: 290, max: 330 }, from: 'assumed' });
  });
});

describe('stepTimeRange', () => {
  it('recovers a range the parser collapsed to its midpoint', () => {
    // Saturday is stored as 2700 s. 45 minutes is a number the coach never wrote.
    expect(stepTimeRange(SATURDAY)).toEqual({ range: { min: 2400, max: 3000 }, from: 'stated' });
  });

  it('keeps a stored duration the note merely agrees with', () => {
    expect(stepTimeRange(MONDAY)).toEqual({ range: { min: 3600, max: 3600 }, from: 'measured' });
  });

  it('ignores minutes in a note that describe something other than the block', () => {
    // The bracket test: 40 minutes is not inside 20–20, so the note is talking
    // about a part of the session and does not redefine its length.
    expect(stepTimeRange(step({ durationValue: 2400, notes: 'כולל 20 דק׳ בקצב' })))
      .toEqual({ range: { min: 2400, max: 2400 }, from: 'measured' });
  });

  it('reads an open-ended step out of its note', () => {
    expect(stepTimeRange(WEDNESDAY)).toEqual({ range: { min: 4200, max: 4800 }, from: 'stated' });
    expect(stepTimeRange(MONDAY_EVENING)).toEqual({ range: { min: 1800, max: 2400 }, from: 'stated' });
  });

  it('converts a measured distance through its pace', () => {
    // 2 km at 5:00–5:30 → 10:00 to 11:00.
    expect(stepTimeRange(step({
      durationType: 'distance', durationValue: 2000,
      targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330,
    }))).toEqual({ range: { min: 600, max: 660 }, from: 'derived' });
  });

  it('multiplies a repeat block out', () => {
    expect(stepTimeRange(step({
      durationType: 'time', durationValue: 0, repeatCount: 6,
      repeatSteps: [
        step({ durationValue: 540, targetPaceMinPerKm: 265 }),
        step({ durationValue: 60, targetPaceMinPerKm: 220 }),
      ],
    }))).toEqual({ range: { min: 3600, max: 3600 }, from: 'measured' });
  });

  it('says nothing about a step that carries nothing', () => {
    expect(stepTimeRange(step({ durationType: 'open', durationValue: undefined })).from).toBe('none');
  });
});

describe('stepDistanceRange — time × pace', () => {
  it('estimates the evening option nobody wrote a distance for', () => {
    // 30–40 min at this club's easy 4:50–5:30. Before this, the Plan tab showed
    // "ללא מרחק" for a session that is most of an hour's running.
    expect(stepDistanceRange(MONDAY_EVENING, { easyBand: { min: 290, max: 330 } }))
      .toEqual({ range: { min: 5455, max: 8276 }, from: 'assumed' });
  });

  it('falls back to the global band with no week to learn from', () => {
    // 30 min ÷ 6:00 = 5.0 km, 40 min ÷ 5:00 = 8.0 km.
    expect(stepDistanceRange(MONDAY_EVENING).range).toEqual({ min: 5000, max: 8000 });
  });

  it('estimates the recovery run from its note', () => {
    expect(stepDistanceRange(WEDNESDAY, { easyBand: { min: 290, max: 330 } }))
      .toEqual({ range: { min: 12727, max: 16552 }, from: 'assumed' });
  });

  it('is derived, not assumed, when the coach wrote the pace', () => {
    // Saturday: 40–50 min at 4:50–5:30.
    expect(stepDistanceRange(SATURDAY)).toEqual({ range: { min: 7273, max: 10345 }, from: 'derived' });
    expect(stepDistanceRange(MONDAY)).toEqual({ range: { min: 10909, max: 12414 }, from: 'derived' });
  });

  it('pairs the shortest time with the slowest pace', () => {
    // Both ends of both ranges the other way round would report 8276–5455.
    const d = stepDistanceRange(SATURDAY).range;
    expect(d.min).toBeLessThan(d.max);
  });

  it('takes a measured distance as measured', () => {
    expect(stepDistanceRange(step({ durationType: 'distance', durationValue: 2000 })))
      .toEqual({ range: { min: 2000, max: 2000 }, from: 'measured' });
  });

  it('multiplies a repeat block by its count', () => {
    // Thursday: 6 × (9 min at 4:25 + 1 min at 3:40).
    expect(stepDistanceRange(step({
      durationType: 'time', durationValue: 0, repeatCount: 6,
      repeatSteps: [
        step({ type: 'interval', durationValue: 540, targetPaceMinPerKm: 265 }),
        step({ type: 'interval', durationValue: 60, targetPaceMinPerKm: 220 }),
      ],
    }))).toEqual({ range: { min: 13_866, max: 13_866 }, from: 'derived' });
  });

  it('leaves an information-free open block alone by default', () => {
    expect(stepDistanceRange(step({ type: 'warmup', durationType: 'open', durationValue: undefined })))
      .toEqual({ range: { min: 0, max: 0 }, from: 'none' });
  });

  it('credits one with a nominal 2 km when the caller asks for it', () => {
    expect(stepDistanceRange(
      step({ type: 'warmup', durationType: 'open', durationValue: undefined }),
      { assumeOpenBlocks: true },
    )).toEqual({ range: { min: 1500, max: 2500 }, from: 'assumed' });
  });
});

describe('easyPaceBand', () => {
  it('reads the club\'s easy pace off its own week', () => {
    // The slowest pace prescribed all week is 5:30, and the bands containing it
    // start at 4:50 — so that is what easy means here, not the global 5:00–6:00.
    expect(easyPaceBand([
      workout([MONDAY, step({ durationType: 'distance', durationValue: 20_000, targetPaceMinPerKm: 265 })]),
      workout([step({ durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330 })]),
    ])).toEqual({ min: 290, max: 330 });
  });

  it('ignores recoveries, which are jogged and not run', () => {
    expect(easyPaceBand([workout([
      step({ targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330 }),
      step({ type: 'recovery', targetPaceMinPerKm: 480 }),
    ])])).toEqual({ min: 290, max: 330 });
  });

  it('looks inside repeat blocks', () => {
    expect(easyPaceBand([workout([
      step({ durationValue: 0, repeatCount: 4, repeatSteps: [step({ targetPaceMinPerKm: 300, targetPaceMaxPerKm: 340 })] }),
    ])])).toEqual({ min: 300, max: 340 });
  });

  it('widens a plan written in single paces, which is not really a range', () => {
    expect(easyPaceBand([workout([step({ targetPaceMinPerKm: 240 })])])).toEqual({ min: 240, max: 280 });
  });

  it('is null for a plan with no paces at all, so the default stands', () => {
    expect(easyPaceBand([workout([MONDAY_EVENING])])).toBeNull();
    expect(planEstimateOptions([workout([MONDAY_EVENING])])).toEqual({});
  });
});

describe('workoutDistanceEstimate', () => {
  it('shows the coach\'s own range instead of averaging it away', () => {
    // "11 – 13 ק"מ" off the plan reached the athlete as "12 ק"מ".
    expect(workoutDistanceEstimate(workout([MONDAY], { distanceMinKm: 11, distanceMaxKm: 13 })))
      .toEqual({ range: { min: 11_000, max: 13_000 }, from: 'coach' });
  });

  it('mirrors a single stated figure into both bounds', () => {
    expect(workoutDistanceEstimate(workout([], { distanceMinKm: 32, distanceMaxKm: 32 })).range)
      .toEqual({ min: 32_000, max: 32_000 });
    expect(workoutDistanceEstimate(workout([], { distanceMaxKm: 10 })).range)
      .toEqual({ min: 10_000, max: 10_000 });
  });

  it('estimates the sessions the coach left blank', () => {
    const e = workoutDistanceEstimate(workout([MONDAY_EVENING]), { easyBand: { min: 290, max: 330 } });
    expect(e).toEqual({ range: { min: 5455, max: 8276 }, from: 'assumed' });
    expect(isEstimate(e.from)).toBe(true);
  });

  it('skips the zero-length wrapper a repeat block hangs off', () => {
    // Every interval session has several of these, and letting one drag the
    // total to `none` would mark the whole week unknown.
    const e = workoutDistanceEstimate(workout([
      step({ durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 300 }),
      step({ type: 'interval', durationValue: 0, notes: '' }),
    ]));
    expect(e).toEqual({ range: { min: 2000, max: 2000 }, from: 'measured' });
  });

  it('is none — not zero — for a session with nothing to go on', () => {
    expect(workoutDistanceEstimate(workout([step({ durationType: 'open', durationValue: undefined })])).from)
      .toBe('none');
  });
});

describe('workoutTimeEstimate', () => {
  it('reports Saturday as the 40–50 minutes it was written as', () => {
    expect(workoutTimeEstimate(workout([SATURDAY])))
      .toEqual({ range: { min: 2400, max: 3000 }, from: 'stated' });
  });
});

describe('weakest', () => {
  it('takes the shakiest source in the sum', () => {
    expect(weakest('coach', 'measured')).toBe('measured');
    expect(weakest('measured', 'assumed', 'stated')).toBe('assumed');
    expect(weakest('coach')).toBe('coach');
  });

  it('marks only calculated numbers as estimates', () => {
    expect(isEstimate('coach')).toBe(false);
    expect(isEstimate('measured')).toBe(false);
    expect(isEstimate('stated')).toBe(false);
    expect(isEstimate('derived')).toBe(true);
    expect(isEstimate('assumed')).toBe(true);
  });
});
