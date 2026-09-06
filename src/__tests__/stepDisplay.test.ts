import { describe, it, expect } from 'vitest';
import {
  isProseStep,
  isRestStep,
  repeatHasMultiplePaces,
  stepMetric,
  stepQualifier,
  LATIN_UNITS,
  type StepUnits,
} from '@/lib/plans/step-display';
import type { WorkoutStep } from '@/lib/ai/types';

// Every case here is a step from the week of 2026-09-06, because every one of
// them rendered wrongly on the card the coach was reading.

const HE: StepUnits = { km: 'ק״מ', m: 'מ׳', sec: 'שנ׳', min: 'דק׳' };

function step(over: Partial<WorkoutStep> = {}): WorkoutStep {
  return {
    order: 1,
    type: 'active',
    durationType: 'distance',
    durationValue: 1000,
    targetType: 'no_target',
    ...over,
  } as WorkoutStep;
}

describe('stepMetric', () => {
  it('formats distance', () => {
    expect(stepMetric(step({ durationValue: 2000 }), HE)).toBe('2 ק״מ');
    expect(stepMetric(step({ durationValue: 23500 }), HE)).toBe('23.5 ק״מ');
    expect(stepMetric(step({ durationValue: 300 }), HE)).toBe('300 מ׳');
    expect(stepMetric(step({ durationValue: 2000 }), LATIN_UNITS)).toBe('2 km');
  });

  it('formats time', () => {
    expect(stepMetric(step({ durationType: 'time', durationValue: 45 }), HE)).toBe('45 שנ׳');
    expect(stepMetric(step({ durationType: 'time', durationValue: 540 }), HE)).toBe('9 דק׳');
    expect(stepMetric(step({ durationType: 'time', durationValue: 90 }), HE)).toBe('1:30');
  });

  it('prefers the coach\'s written range over the parser\'s single figure', () => {
    // Saturday: "40-50 דק׳ 4:50-5:30" stored as 2700s. "45 דק׳" is a decision
    // the athlete never made.
    expect(stepMetric(step({ durationType: 'time', durationValue: 2700, notes: '40-50 דק׳ 4:50-5:30' }), HE))
      .toBe('40–50 דק׳');
  });

  it('keeps the stored figure when the note states the same single number', () => {
    expect(stepMetric(step({ durationType: 'time', durationValue: 3600, notes: '60 דק׳ 4:50-5:30' }), HE))
      .toBe('60 דק׳');
  });

  it('is empty for a prose step, whose note carries the metric', () => {
    expect(stepMetric(step({ durationType: 'open', durationValue: undefined, notes: '70-80 דק׳ קל' }), HE)).toBe('');
  });
});

describe('isProseStep', () => {
  it('is the open step, and only it', () => {
    expect(isProseStep(step({ durationType: 'open', durationValue: undefined }))).toBe(true);
    expect(isProseStep(step({ durationType: 'distance', durationValue: undefined }))).toBe(true);
    expect(isProseStep(step({ durationValue: 1000 }))).toBe(false);
    expect(isProseStep(step({ durationType: 'time', durationValue: 45 }))).toBe(false);
  });
});

describe('stepQualifier', () => {
  it('keeps a real qualifier', () => {
    expect(stepQualifier(step({ type: 'rest', durationType: 'time', durationValue: 45, notes: 'הליכה' })))
      .toBe('הליכה');
    expect(stepQualifier(step({ type: 'interval', durationType: 'time', durationValue: 15, notes: 'מתגברת' })))
      .toBe('מתגברת');
  });

  it('drops a note that only restates the pace', () => {
    // The most common note in the plan. Printed verbatim it says 4:25 twice.
    expect(stepQualifier(step({
      durationValue: 20000, targetType: 'pace', targetPaceMinPerKm: 265, targetPaceMaxPerKm: 265, notes: '4:25',
    }))).toBe('');
  });

  it('drops a hyphenated pace range even though the token uses an en dash', () => {
    expect(stepQualifier(step({
      durationValue: 2000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330, notes: '5:00-5:30',
    }))).toBe('');
  });

  it('drops the duration too, and keeps what is actually new', () => {
    expect(stepQualifier(step({
      durationType: 'time', durationValue: 3600, targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 330,
      notes: '60 דק׳ 4:50-5:30',
    }))).toBe('');
    expect(stepQualifier(step({
      type: 'interval', durationValue: 300, targetType: 'pace', targetPaceMinPerKm: 210,
      notes: '3:30 לא מהר מזה!',
    }))).toBe('לא מהר מזה!');
  });

  it('drops the ❷/❸ brackets when the step carries those paces in fields', () => {
    // Tuesday's intervals: the note IS the club notation, and the screens that
    // print it print a column per group beside it.
    expect(stepQualifier(step({
      type: 'interval', durationType: 'time', durationValue: 45,
      targetType: 'pace', targetPaceMinPerKm: 230, targetPaceMaxPerKm: 230,
      group2Pace: { min: 240, max: 240 }, group3Pace: { min: 250, max: 250 },
      notes: '3:50 (4:00) ((4:10))',
    }))).toBe('');
    expect(stepQualifier(step({
      type: 'interval', durationValue: 300,
      targetType: 'pace', targetPaceMinPerKm: 210,
      group2Pace: { min: 220, max: 220 }, group3Pace: { min: 230, max: 230 },
      notes: '3:30 (3:40) ((3:50)) לא מהר מזה!',
    }))).toBe('לא מהר מזה!');
  });

  it('keeps a bracket with no group field behind it', () => {
    // Unsplit steps exist, and there the bracket is the ONLY place ❷'s pace is
    // written — stripping it would delete the number instead of de-duplicating it.
    expect(stepQualifier(step({
      type: 'interval', durationType: 'time', durationValue: 45,
      targetType: 'pace', targetPaceMinPerKm: 230, targetPaceMaxPerKm: 230,
      notes: '3:50 (4:00) ((4:10))',
    }))).toBe('(4:00) ((4:10))');
    // …and a bracket that isn't a pace at all is prose, whatever the fields say.
    expect(stepQualifier(step({
      type: 'interval', durationType: 'time', durationValue: 45,
      targetType: 'pace', targetPaceMinPerKm: 230,
      group2Pace: { min: 240, max: 240 },
      notes: '3:50 (4:00) (בעלייה)',
    }))).toBe('(בעלייה)');
  });

  it('strips the asterisks the program uses for emphasis', () => {
    expect(stepQualifier(step({
      durationValue: 1000, targetType: 'pace', targetPaceMinPerKm: 300, targetPaceMaxPerKm: 330,
      notes: '5:00-5:30 ** לא לרוץ מהר יותר מהקצב שרשום **',
    }))).toBe('לא לרוץ מהר יותר מהקצב שרשום');
  });

  it('never mangles a prose step', () => {
    // Stripping "30-40 דק׳" here leaves "אופציה ל קל בערב".
    const note = 'אופציה ל30-40 דק׳ קל בערב / כוח';
    expect(stepQualifier(step({ durationType: 'open', durationValue: undefined, notes: note }))).toBe(note);
    expect(stepQualifier(step({ durationType: 'open', durationValue: undefined, notes: '70-80 דק׳ ריצת שחרור קלה' })))
      .toBe('70-80 דק׳ ריצת שחרור קלה');
  });

  it('is empty for a step with no note', () => {
    expect(stepQualifier(step())).toBe('');
  });
});

describe('repeatHasMultiplePaces', () => {
  it('is true for Thursday — 6 × (9 דק׳ @4:25 + 1 דק׳ @3:40)', () => {
    expect(repeatHasMultiplePaces(step({
      repeatCount: 6,
      repeatSteps: [
        step({ type: 'interval', durationType: 'time', durationValue: 540, targetPaceMinPerKm: 265 }),
        step({ type: 'interval', durationType: 'time', durationValue: 60, targetPaceMinPerKm: 220 }),
      ],
    }))).toBe(true);
  });

  it('is false for a work + recovery block', () => {
    expect(repeatHasMultiplePaces(step({
      repeatCount: 8,
      repeatSteps: [
        step({ type: 'interval', durationType: 'time', durationValue: 15 }),
        step({ type: 'rest', durationType: 'time', durationValue: 45 }),
      ],
    }))).toBe(false);
  });

  it('treats both rest and recovery as recovery', () => {
    expect(isRestStep(step({ type: 'rest' }))).toBe(true);
    expect(isRestStep(step({ type: 'recovery' }))).toBe(true);
    expect(isRestStep(step({ type: 'interval' }))).toBe(false);
  });
});
