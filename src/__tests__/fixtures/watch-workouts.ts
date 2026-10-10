import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

/**
 * Real workout shapes, collected from the plans and tests this codebase already
 * carries (fullWeekPlan, converter, garminWorkoutEditable, qualityPlanDays,
 * workoutParts). Shared by the WatchWorkoutV1 serializer tests and the Garmin
 * golden snapshot, so both are pinned against the same inputs.
 */

const s = (over: Partial<WorkoutStep>): WorkoutStep => ({
  order: 1,
  type: 'active',
  durationType: 'distance',
  durationValue: 1000,
  targetType: 'no_target',
  ...over,
}) as WorkoutStep;

/** Sunday fartlek from the 28.06 PDF: 15' 4:30-5:30, then 15 x (1' / 1' / 1') by feel. */
export const fartlek: ParsedWorkout = {
  dayOfWeek: 0,
  name: 'יום ראשון',
  workoutKey: 'd0-p1-single',
  steps: [
    s({ order: 1, type: 'warmup', durationType: 'time', durationValue: 900, targetType: 'pace', targetPaceMinPerKm: 270, targetPaceMaxPerKm: 330, notes: '15 דק׳ 4:30-5:30' }),
    {
      order: 2, type: 'interval', durationType: 'time', durationValue: 60, targetType: 'no_target',
      repeatCount: 15,
      repeatSteps: [
        s({ order: 1, type: 'interval', durationType: 'time', durationValue: 60, notes: 'קל מתון - נוח' }),
        s({ order: 2, type: 'interval', durationType: 'time', durationValue: 60, notes: 'מתון - בינוני' }),
        s({ order: 3, type: 'interval', durationType: 'time', durationValue: 60, notes: 'בינוני - קשה' }),
      ],
    },
  ],
};

/** Monday easy run: one open step whose pace lives only in the notes. */
export const easyOpen: ParsedWorkout = {
  dayOfWeek: 1,
  name: 'יום שני',
  workoutKey: 'd1-p1-single',
  steps: [s({ order: 1, type: 'active', durationType: 'open', durationValue: undefined, notes: '60-80 דקות 4:40-5:15' })],
};

/** 2 km warm-up, 6x(400 m @3:20 + 200 m recovery), 1 km cool-down. */
export const intervals: ParsedWorkout = {
  dayOfWeek: 2,
  name: 'אינטרוולים 6×400',
  workoutKey: 'd2-p1-single',
  steps: [
    s({ order: 1, type: 'warmup', durationValue: 2000 }),
    s({
      order: 2,
      durationType: 'open',
      repeatCount: 6,
      repeatSteps: [
        s({ order: 1, type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 200, notes: '3:20' }),
        s({ order: 2, type: 'recovery', durationType: 'time', durationValue: 60, notes: 'הליכה' }),
      ],
    }),
    s({ order: 3, type: 'cooldown', durationValue: 1000 }),
  ],
};

/** Tempo with a pace RANGE and a gel cue, between two warmups and two cooldowns. */
export const tempoDoubleWarmup: ParsedWorkout = {
  dayOfWeek: 3,
  name: 'טמפו',
  workoutKey: 'd3-p1-single',
  steps: [
    s({ order: 1, type: 'warmup', durationType: 'time', durationValue: 900, notes: 'קל' }),
    s({ order: 2, type: 'warmup', durationType: 'distance', durationValue: 400, notes: 'האצות' }),
    s({ order: 3, type: 'interval', durationValue: 8000, targetType: 'pace', targetPaceMinPerKm: 215, targetPaceMaxPerKm: 225, notes: 'ג׳ל' }),
    s({ order: 4, type: 'cooldown', durationType: 'time', durationValue: 300 }),
    s({ order: 5, type: 'cooldown', durationType: 'open', durationValue: undefined, notes: 'מתיחות' }),
  ],
};

/** A nested repeat: 3 x (4 x (200 m fast + 200 m jog) + 400 m float). */
export const nestedRepeat: ParsedWorkout = {
  dayOfWeek: 4,
  name: 'סטים',
  workoutKey: 'd4-p1-single',
  steps: [
    s({ order: 1, type: 'warmup', durationValue: 3000 }),
    s({
      order: 2,
      durationType: 'open',
      repeatCount: 3,
      repeatSteps: [
        s({
          order: 1,
          durationType: 'open',
          repeatCount: 4,
          repeatSteps: [
            s({ order: 1, type: 'interval', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 190, targetPaceMaxPerKm: 195 }),
            s({ order: 2, type: 'rest', durationValue: 200 }),
          ],
        }),
        s({ order: 2, type: 'recovery', durationValue: 400, notes: 'ציפה' }),
      ],
    }),
    s({ order: 3, type: 'cooldown', durationValue: 2000 }),
  ],
};

/** A zone-only pace step against the production offset profile — the 2026-05-31 Saturday shape. */
export const zoneOnly: ParsedWorkout = {
  dayOfWeek: 6,
  name: 'שבת קל',
  workoutKey: 'd6-p1-single',
  steps: [s({ order: 1, type: 'active', durationValue: 12000, targetType: 'pace', targetZone: 'easy', notes: 'ריצה קלה' })],
};

/** Heart-rate target by % of max. */
export const heartRate: ParsedWorkout = {
  dayOfWeek: 5,
  name: 'ריצת דופק',
  workoutKey: 'd5-p1-single',
  steps: [
    s({ order: 1, type: 'active', durationType: 'time', durationValue: 2700, targetType: 'heart_rate', targetHrMinPct: 70, targetHrMaxPct: 78 }),
  ],
};

/** The double day: a test part with its own warmup/cooldown parts, and an optional evening. */
export const doubleDayParts: ParsedWorkout[] = [
  { dayOfWeek: 1, name: 'חימום', workoutKey: 'd1-p1-warmup', partIndex: 1, partCount: 4, partKind: 'warmup', steps: [s({ order: 1, type: 'warmup', durationType: 'time', durationValue: 1200 })] },
  { dayOfWeek: 1, name: 'טסט 2,000', workoutKey: 'd1-p2-test', partIndex: 2, partCount: 4, partKind: 'test', steps: [s({ order: 1, type: 'interval', durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 200 })] },
  { dayOfWeek: 1, name: 'שחרור', workoutKey: 'd1-p3-cooldown', partIndex: 3, partCount: 4, partKind: 'cooldown', steps: [s({ order: 1, type: 'cooldown', durationType: 'time', durationValue: 600 })] },
  {
    dayOfWeek: 1, name: 'שני - ערב אופציה', workoutKey: 'd1-p4-evening', partIndex: 4, partCount: 4, partKind: 'evening', optional: true,
    steps: [s({ order: 1, durationType: 'open', repeatCount: 6, repeatSteps: [s({ order: 1, type: 'interval', durationValue: 200 }), s({ order: 2, type: 'rest', durationValue: 200 })] })],
  },
];

/** A part with no steps at all (the parser produced a title only). */
export const empty: ParsedWorkout = { dayOfWeek: 2, name: 'מנוחה פעילה', workoutKey: 'd2-p2-single', steps: [] };

/** A repeat whose child list came back empty, and a half-filled repeat (count, no steps). */
export const brokenRepeats: ParsedWorkout = {
  dayOfWeek: 3,
  name: 'שבור',
  workoutKey: 'd3-p2-single',
  steps: [
    s({ order: 1, durationType: 'open', repeatCount: 5, repeatSteps: [] }),
    s({ order: 2, durationType: 'distance', durationValue: 5000, repeatCount: 3 }),
  ],
};

export const ALL_FIXTURES: Record<string, ParsedWorkout> = {
  fartlek,
  easyOpen,
  intervals,
  tempoDoubleWarmup,
  nestedRepeat,
  zoneOnly,
  heartRate,
  empty,
  brokenRepeats,
  ...Object.fromEntries(doubleDayParts.map((w) => [w.workoutKey!, w])),
};
