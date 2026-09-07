import { describe, expect, it } from 'vitest';
import {
  compareKm, derivedKm, formatKm, headerKm, reviewDay, reviewWeek,
} from '@/lib/plans/day-review';
import { planEstimateOptions } from '@/lib/plans/step-estimate';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The week of 12.07.26, as it was actually read out of the PDF — five of its
// seven days state a time and no kilometres, which is the case the whole module
// exists for. The numbers asserted below were measured off that week.

const EASY = { easyBand: { min: 290, max: 330 } };

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1, type: 'active', durationType: 'time', durationValue: 600, targetType: 'pace',
    ...over,
  } as WorkoutStep;
}

function workout(steps: WorkoutStep[], over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return { dayOfWeek: 0, name: '', steps, ...over } as ParsedWorkout;
}

/** Monday: "50 דק׳ 4:50-5:30", and the coach's own 9 – 11 ק״מ on the day header. */
const MONDAY = workout([
  step({ durationValue: 3000, targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330 }),
], { dayOfWeek: 1, distanceMinKm: 9, distanceMaxKm: 11 });

/** Monday evening: offered, not prescribed — 30–40 min at the same easy band. */
const MONDAY_EVENING = workout([
  step({ durationValue: 2100, notes: '30-40 דק׳ קל', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330 }),
], { dayOfWeek: 1, optional: true });

describe('headerKm', () => {
  it('is the range printed on the plan', () => {
    expect(headerKm(MONDAY)).toEqual({ min: 9, max: 11 });
  });

  it('is null when the day header carried no kilometres', () => {
    expect(headerKm(MONDAY_EVENING)).toBeNull();
  });

  it('reads a single figure as a range of one', () => {
    expect(headerKm(workout([], { distanceMinKm: 12 }))).toEqual({ min: 12, max: 12 });
    expect(headerKm(workout([], { distanceMaxKm: 12 }))).toEqual({ min: 12, max: 12 });
  });
});

describe('derivedKm', () => {
  it('multiplies a time by a pace instead of echoing the header', () => {
    // 50 min ÷ 5:30 = 9.1 km; 50 min ÷ 4:50 = 10.3 km. The header says 9–11, and
    // the whole point is that this number was worked out WITHOUT looking at it.
    expect(derivedKm(MONDAY).range).toEqual({ min: 9.1, max: 10.3 });
  });

  it('is an estimate, and says so', () => {
    expect(derivedKm(MONDAY).from).toBe('derived');
  });

  it('refuses to credit an information-free warmup with a nominal distance', () => {
    // `assumeOpenBlocks` would put 1.5–2.5 km here, which is exactly how a day
    // that lost its warmup comes out agreeing with its own header.
    const open = workout([
      step({ type: 'warmup', durationType: 'open', durationValue: undefined, targetType: 'no_target' }),
    ]);
    expect(derivedKm(open, EASY).range).toBeNull();
  });

  it('skips the empty wrapper a repeat block hangs off', () => {
    const set = workout([
      step({ order: 1, durationType: 'time', durationValue: 0, targetType: 'no_target' }),
      step({
        order: 2, type: 'interval', durationValue: 0, repeatCount: 10,
        repeatSteps: [
          step({ order: 1, durationType: 'distance', durationValue: 200, targetPaceMinPerKm: 200 }),
        ],
      }),
    ]);
    expect(derivedKm(set, EASY).range).toEqual({ min: 2, max: 2 });
  });

  it('is null when no step carries anything to multiply', () => {
    expect(derivedKm(workout([]), EASY)).toEqual({ range: null, from: 'none' });
  });
});

describe('compareKm', () => {
  it('agrees when the steps land inside the header', () => {
    expect(compareKm({ min: 9, max: 11 }, { min: 9.1, max: 10.3 })).toBe('match');
  });

  it('agrees when they overlap it at one end', () => {
    // Wednesday: 70 min at 4:50–5:30 is 12.7–14.5 against a header of 13–19.
    expect(compareKm({ min: 13, max: 19 }, { min: 12.7, max: 14.5 })).toBe('match');
  });

  it('calls a truncated day short', () => {
    // Tuesday, cut off at the page break: 11.2 km against a header of 16–18.
    expect(compareKm({ min: 16, max: 18 }, { min: 11.2, max: 11.2 })).toBe('below');
  });

  it('calls another day\'s work landing on this one long', () => {
    expect(compareKm({ min: 9, max: 11 }, { min: 16.2, max: 16.2 })).toBe('above');
  });

  it('forgives half a kilometre, which is the arithmetic\'s own noise', () => {
    expect(compareKm({ min: 13, max: 15 }, { min: 12.6, max: 12.8 })).toBe('match');
    expect(compareKm({ min: 13, max: 15 }, { min: 12.1, max: 12.4 })).toBe('below');
  });

  it('has no opinion without both figures', () => {
    expect(compareKm(null, { min: 9, max: 10 })).toBe('unchecked');
    expect(compareKm({ min: 9, max: 11 }, null)).toBe('unchecked');
  });
});

describe('reviewDay', () => {
  const week = [MONDAY, MONDAY_EVENING];
  const day = reviewDay(1, '2026-07-12', week, planEstimateOptions(week));

  it('dates the day off the week\'s Sunday', () => {
    expect(day.dateKey).toBe('2026-07-13');
  });

  it('publishes the coach\'s own range, not the multiplication', () => {
    expect(day.publishKm).toEqual({ min: 9, max: 11 });
    expect(day.publishFrom).toBe('header');
    expect(day.check).toBe('match');
  });

  it('keeps the offered session out of the day\'s total and names it separately', () => {
    // 35 min at the easy band, on offer. Adding it in would print a Monday
    // nobody in the club runs.
    expect(day.derivedKm).toEqual({ min: 9.1, max: 10.3 });
    expect(day.optionalKm).not.toBeNull();
    expect(day.sessions).toHaveLength(2);
  });

  it('falls back to the steps on a day the document wrote in time only', () => {
    const wednesday = [workout([
      step({ durationValue: 4200, targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330, notes: '70-90 דק׳' }),
    ], { dayOfWeek: 3 })];
    const d = reviewDay(3, '2026-07-12', wednesday, planEstimateOptions(wednesday));
    expect(d.publishFrom).toBe('derived');
    // The note's own 70–90 outranks the collapsed 70, so the athlete's day is
    // 12.7–18.6 rather than the 12.7–14.5 the stored value alone would give.
    expect(formatKm(d.publishKm)).toBe('12.7–18.6');
    expect(d.check).toBe('unchecked');
  });

  it('does not double-count a day header copied onto both of its parts', () => {
    const parts = [
      workout([step({ durationValue: 1800, targetPaceMinPerKm: 290 })], { dayOfWeek: 2, distanceMinKm: 16, distanceMaxKm: 18, partIndex: 1 }),
      workout([step({ durationValue: 1800, targetPaceMinPerKm: 290 })], { dayOfWeek: 2, distanceMinKm: 16, distanceMaxKm: 18, partIndex: 2 }),
    ];
    expect(reviewDay(2, '2026-07-12', parts, EASY).headerKm).toEqual({ min: 16, max: 18 });
  });

  it('adds up two parts that carry their own different headers', () => {
    const parts = [
      workout([step({ durationValue: 1800 })], { dayOfWeek: 2, distanceMinKm: 10, distanceMaxKm: 10 }),
      workout([step({ durationValue: 1800 })], { dayOfWeek: 2, distanceMinKm: 6, distanceMaxKm: 8 }),
    ];
    expect(reviewDay(2, '2026-07-12', parts, EASY).headerKm).toEqual({ min: 16, max: 18 });
  });

  it('reports a day with nothing on it as a rest day', () => {
    const rest = reviewDay(5, '2026-07-12', [MONDAY], EASY);
    expect(rest.check).toBe('rest');
    expect(rest.publishKm).toBeNull();
  });
});

describe('reviewWeek', () => {
  /** Tuesday as it was misread: the session cut off at the page break. */
  const TUESDAY_CUT = workout([
    step({ order: 1, type: 'warmup', durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 300 }),
    step({ order: 2, type: 'interval', durationValue: 45, targetPaceMinPerKm: 200, targetPaceMaxPerKm: 230 }),
  ], { dayOfWeek: 2, distanceMinKm: 16, distanceMaxKm: 18 });

  const week = [MONDAY, MONDAY_EVENING, TUESDAY_CUT];
  const review = reviewWeek(week, '2026-07-12', planEstimateOptions(week));

  it('is always seven days, rest days included', () => {
    expect(review.days).toHaveLength(7);
    expect(review.trainingDays).toBe(2);
  });

  it('holds the coach\'s weekly total against the same days built from their steps', () => {
    expect(review.headerKm).toEqual({ min: 25, max: 29 });
    expect(review.check).toBe('below');
    expect(review.checkedDays).toBe(2);
  });

  it('counts the days whose kilometres had to be worked out', () => {
    expect(review.derivedDays).toBe(2);
  });

  it('names the days still carrying a warning, in day order', () => {
    expect(review.daysNeedingReview).toEqual([1, 2]);
    expect(review.sessionsWithWarnings).toBeGreaterThan(0);
  });

  it('gives one figure for what will be published', () => {
    // Monday's header + Tuesday's header; the offered evening is not in it.
    expect(formatKm(review.publishKm)).toBe('25–29');
  });
});

describe('formatKm', () => {
  it('collapses a range whose ends agree', () => {
    expect(formatKm({ min: 12, max: 12 })).toBe('12');
  });

  it('is empty for nothing, so a caller can print it bare', () => {
    expect(formatKm(null)).toBe('');
  });
});
