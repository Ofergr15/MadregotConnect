import { describe, it, expect } from 'vitest';
import { formatPaceRange, groupPaceTokens, joinGroupPaces, stepPaceTokens } from '@/lib/garmin/pace';
import { splitRepeatSteps } from '@/lib/plans/repeat-block';

describe('formatPaceRange', () => {
  it('single pace when min===max', () => {
    expect(formatPaceRange(230, 230)).toBe('3:50');
  });
  it('range when min!==max', () => {
    expect(formatPaceRange(280, 330)).toBe('4:40–5:30');
  });
  it('single pace when only min given', () => {
    expect(formatPaceRange(250)).toBe('4:10');
  });
  it('empty when no pace', () => {
    expect(formatPaceRange(null, null)).toBe('');
    expect(formatPaceRange(0)).toBe('');
  });
});

describe('groupPaceTokens + joinGroupPaces', () => {
  it('builds "3:50 (4:00) ((4:10))" from three group paces', () => {
    const tokens = groupPaceTokens(
      { min: 230, max: 230 },
      { min: 240, max: 240 },
      { min: 250, max: 250 },
    );
    expect(tokens).toEqual(['3:50', '4:00', '4:10']);
    expect(joinGroupPaces(tokens)).toBe('3:50 (4:00) ((4:10))');
  });

  it('skips groups without a pace', () => {
    const tokens = groupPaceTokens({ min: 230, max: 230 }, null, null);
    expect(joinGroupPaces(tokens)).toBe('3:50');
  });

  it('handles ranges per group', () => {
    const tokens = groupPaceTokens(
      { min: 280, max: 330 },
      { min: 290, max: 340 },
      { min: 300, max: 350 },
    );
    expect(joinGroupPaces(tokens)).toBe('4:40–5:30 (4:50–5:40) ((5:00–5:50))');
  });
});

describe('stepPaceTokens', () => {
  it('reads ❶ off the step and ❷❸ off its group paces', () => {
    expect(stepPaceTokens({
      targetType: 'pace',
      targetPaceMinPerKm: 225,
      targetPaceMaxPerKm: 225,
      group2Pace: { min: 235, max: 235 },
      group3Pace: { min: 245, max: 245 },
    })).toEqual(['3:45', '3:55', '4:05']);
  });

  it('carries a ❶ range through', () => {
    expect(stepPaceTokens({ targetType: 'pace', targetPaceMinPerKm: 290, targetPaceMaxPerKm: 310 }))
      .toEqual(['4:50–5:10', '', '']);
  });

  it('treats a missing max as a single pace, not an open-ended range', () => {
    expect(stepPaceTokens({ targetType: 'pace', targetPaceMinPerKm: 270 })).toEqual(['4:30', '', '']);
  });

  // All three empty is the signal to render NOTHING — a recovery jog must not
  // get a dash or a zero holding open the pace column.
  it('is empty for a step with no pace', () => {
    expect(stepPaceTokens({ targetType: 'no_target', targetPaceMinPerKm: 270 })).toEqual(['', '', '']);
    expect(stepPaceTokens({ targetType: 'pace' })).toEqual(['', '', '']);
    expect(stepPaceTokens({})).toEqual(['', '', '']);
  });
});

describe('splitRepeatSteps', () => {
  const work = { type: 'interval', durationValue: 1000 };
  const jog = { type: 'recovery', durationValue: 90 };

  it('leads with the work interval even when the recovery is written first', () => {
    expect(splitRepeatSteps([jog, work])).toEqual({ lead: work, rest: [jog] });
  });

  it('keeps the coach order of everything below the lead', () => {
    const four = { type: 'interval', durationValue: 400 };
    const eight = { type: 'interval', durationValue: 800 };
    // A pyramid: only the first leg is promoted, the rest still render (with
    // their own paces) on the lines underneath.
    expect(splitRepeatSteps([four, jog, eight, jog])).toEqual({ lead: four, rest: [jog, eight, jog] });
  });

  it('falls back to the first step when every sub-step is a recovery', () => {
    expect(splitRepeatSteps([jog, jog])).toEqual({ lead: jog, rest: [jog] });
  });

  it('has no lead for an empty block', () => {
    expect(splitRepeatSteps([])).toEqual({ lead: null, rest: [] });
  });
});
