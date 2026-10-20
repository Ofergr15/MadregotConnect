import { describe, expect, it } from 'vitest';
import { sameOnWatch } from '@/lib/watch/changes';

const step = (description: string, seconds: number) => ({ description, endCondition: { conditionTypeKey: 'time' }, endConditionValue: seconds, stepId: 1 });
const wk = (steps: unknown[]) => ({ workoutName: 'שלישי', sportType: { sportTypeKey: 'running' }, workoutSegments: [{ workoutSteps: steps }] });

describe('what is on the watch, against what would go now', () => {
  it('is the same whatever order the database kept the keys in, and without the ids Garmin adds', () => {
    const sent = { workoutSegments: [{ workoutSteps: [{ stepId: 1, endConditionValue: 1800, endCondition: { conditionTypeKey: 'time' }, description: '4:50-5:30' }] }], sportType: { sportTypeKey: 'running' }, workoutName: 'שלישי', workoutId: 999, ownerId: 5 };
    expect(sameOnWatch(wk([step('4:50-5:30', 1800)]), sent)).toBe(true);
  });

  it('ignores spacing and dash style in the watch text', () => {
    expect(sameOnWatch(wk([step('4:50–5:30', 1800)]), wk([step('4:50 – 5:30', 1800)]))).toBe(true);
  });

  it('sees a real edit: a different pace, distance or number of reps', () => {
    expect(sameOnWatch(wk([step('3:10', 45)]), wk([step('3:15', 45)]))).toBe(false);
    expect(sameOnWatch(wk([step('4:50-5:30', 2400)]), wk([step('4:50-5:30', 1800)]))).toBe(false);
    expect(sameOnWatch(wk([step('a', 1), step('b', 2)]), wk([step('a', 1)]))).toBe(false);
  });
});
