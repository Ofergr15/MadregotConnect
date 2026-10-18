import { describe, expect, it } from 'vitest';
import { parseWorkout } from '@/lib/day-session/model';

/** "50-70 דק׳" in the one-day session (Ofer, 2026-10-18): it published as 60. */
describe('a one-day session keeps a time range', () => {
  it('the near end for the watch, the far end for the card', () => {
    const p = parseWorkout('50-70 דק׳ 4:40 - 5:15');
    expect(p.steps[0]).toMatchObject({ durationType: 'time', durationValue: 3000, durationMaxValue: 4200 });
    expect(p.title).toBe('50–70 דק׳');
  });

  it('either order, any dash', () => {
    expect(parseWorkout('70 - 50 דקות').steps[0]).toMatchObject({ durationValue: 3000, durationMaxValue: 4200 });
    expect(parseWorkout('50–70 דק׳').steps[0]).toMatchObject({ durationValue: 3000, durationMaxValue: 4200 });
  });

  it('one number stays one number, and a distance range is unchanged', () => {
    expect(parseWorkout('50 דק׳').steps[0].durationMaxValue).toBeUndefined();
    expect(parseWorkout('10-12 ק״מ').steps[0]).toMatchObject({ durationType: 'distance', durationValue: 11000 });
  });
});
