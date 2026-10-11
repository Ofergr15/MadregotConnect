import { describe, it, expect } from 'vitest';
import type { AutoFix, WorkoutStep } from '@/lib/ai/types';
import {
  withIds, stripIds, moveStep, insertAt, removeStep, duplicateStep, unwrapRepeat,
  remapAutoFixes, parseDistance, parseTime, parsePace, durationBoxText, newId, type DraftStep,
} from '@/lib/plans/step-tree';

// Week 11.10, Sunday, exactly as the parse stored it: the 4:00 "between sets" rest is
// the LAST sub-step of the 3× hills, so the watch plays it after every set.
const sunday = (): WorkoutStep[] => [
  { order: 1, type: 'warmup', durationType: 'time', durationValue: 900, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315 },
  {
    order: 2, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', repeatCount: 3,
    repeatSteps: [
      { order: 1, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', notes: 'עליה' },
      { order: 2, type: 'rest', durationType: 'open', targetType: 'no_target', notes: 'עמידה הליכה למטה' },
      { order: 3, type: 'interval', durationType: 'time', durationValue: 20, targetType: 'no_target', notes: 'עליה' },
      { order: 4, type: 'rest', durationType: 'open', targetType: 'no_target', notes: 'עמידה הליכה למטה' },
      { order: 5, type: 'interval', durationType: 'time', durationValue: 10, targetType: 'no_target', notes: 'עליה' },
      { order: 6, type: 'rest', durationType: 'time', durationValue: 240, targetType: 'no_target', notes: 'בין סטים' },
    ],
  },
  { order: 3, type: 'active', durationType: 'time', durationValue: 2400, targetType: 'pace', targetPaceMinPerKm: 255, targetPaceMaxPerKm: 255 },
];

const shape = (steps: WorkoutStep[]) =>
  steps.map((s) => (s.repeatSteps ? `${s.repeatCount}x[${s.repeatSteps.map((c) => c.durationValue ?? 'lap').join(',')}]` : String(s.durationValue ?? 'lap')));

describe('moveStep', () => {
  it('takes the between-sets rest out of the repeat, to between the hills and the run', () => {
    const d = withIds(sunday());
    const rest = d[1].repeatSteps![5];
    const out = moveStep(d, rest._id, { kind: 'top', index: 2 })!;
    const saved = stripIds(out);
    expect(shape(saved)).toEqual(['900', '3x[30,lap,20,lap,10]', '240', '2400']);
    expect(saved.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    expect(saved[1].repeatSteps!.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('puts a top-level step inside a repeat at the exact position', () => {
    const d = withIds(sunday());
    const out = moveStep(d, d[2]._id, { kind: 'in', repeatId: d[1]._id, index: 1 })!;
    expect(shape(stripIds(out))).toEqual(['900', '3x[30,2400,lap,20,lap,10,240]']);
  });

  it('reorders within the same list without an off-by-one', () => {
    const d = withIds(sunday());
    // warm-up dropped on the gap after the run → it becomes last
    expect(shape(stripIds(moveStep(d, d[0]._id, { kind: 'top', index: 3 })!))).toEqual(['3x[30,lap,20,lap,10,240]', '2400', '900']);
    // run dropped on the gap before the repeat
    expect(shape(stripIds(moveStep(d, d[2]._id, { kind: 'top', index: 1 })!))).toEqual(['900', '2400', '3x[30,lap,20,lap,10,240]']);
  });

  it('refuses a repeat inside a repeat, and no-op drops', () => {
    const d = withIds(sunday());
    const two: DraftStep = { _id: newId(), order: 9, type: 'interval', durationType: 'time', targetType: 'no_target', repeatCount: 2, repeatSteps: [{ ...d[0], _id: newId() }] };
    const withTwo = insertAt(d, two, { kind: 'top', index: 3 })!;
    expect(moveStep(withTwo, two._id, { kind: 'in', repeatId: d[1]._id, index: 0 })).toBeNull();
    expect(moveStep(d, d[0]._id, { kind: 'top', index: 0 })).toBeNull();
    expect(moveStep(d, d[2]._id, { kind: 'top', index: 3 })).toBeNull();
  });

  it('drops a repeat that the move left empty', () => {
    const one = withIds([{ order: 1, type: 'interval', durationType: 'time', targetType: 'no_target', repeatCount: 2, repeatSteps: [{ order: 1, type: 'interval', durationType: 'time', durationValue: 60, targetType: 'no_target' }] }]);
    const out = moveStep(one, one[0].repeatSteps![0]._id, { kind: 'top', index: 0 })!;
    expect(shape(stripIds(out))).toEqual(['60']);
  });

  it('does not mutate its input', () => {
    const d = withIds(sunday());
    const before = JSON.stringify(d);
    moveStep(d, d[1].repeatSteps![5]._id, { kind: 'top', index: 2 });
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('the other edits', () => {
  it('inserts anywhere, not only at the end', () => {
    const d = withIds(sunday());
    const rest: DraftStep = { _id: newId(), order: 0, type: 'rest', durationType: 'time', durationValue: 120, targetType: 'no_target' };
    expect(shape(stripIds(insertAt(d, rest, { kind: 'top', index: 1 })!))).toEqual(['900', '120', '3x[30,lap,20,lap,10,240]', '2400']);
    expect(shape(stripIds(insertAt(d, rest, { kind: 'in', repeatId: d[1]._id, index: 0 })!))).toEqual(['900', '3x[120,30,lap,20,lap,10,240]', '2400']);
  });

  it('duplicates with fresh ids, deletes, unwraps', () => {
    const d = withIds(sunday());
    const dup = duplicateStep(d, d[1]._id)!;
    expect(dup.steps).toHaveLength(4);
    expect(dup.steps[2].repeatSteps![0]._id).not.toBe(d[1].repeatSteps![0]._id);
    expect(shape(stripIds(removeStep(d, d[0]._id)))).toEqual(['3x[30,lap,20,lap,10,240]', '2400']);
    expect(shape(stripIds(unwrapRepeat(d, d[1]._id)))).toEqual(['900', '30', 'lap', '20', 'lap', '10', '240', '2400']);
  });

  it('mirrors a repeat parent from its new first sub-step', () => {
    const d = withIds(sunday());
    const out = stripIds(moveStep(d, d[1].repeatSteps![1]._id, { kind: 'in', repeatId: d[1]._id, index: 0 })!);
    expect(out[1].type).toBe('rest');
    expect(out[1].durationType).toBe('open');
    expect(out[0].repeatSteps).toBeUndefined();
  });
});

describe('remapAutoFixes', () => {
  it('follows the step it was made on, and drops a fix whose step is gone', () => {
    const d = withIds(sunday());
    const fixes: AutoFix[] = [
      { code: 'timeRange', stepPath: [2], fromSec: 2400, toSec: { min: 2400, max: 3000 } },
      { code: 'timeRange', stepPath: [1, 5], fromSec: 240, toSec: { min: 240, max: 300 } },
    ];
    const moved = moveStep(d, d[1].repeatSteps![5]._id, { kind: 'top', index: 2 })!;
    expect(remapAutoFixes(fixes, d, moved)!.map((f) => f.stepPath)).toEqual([[3], [2]]);
    const deleted = removeStep(d, d[2]._id);
    expect(remapAutoFixes(fixes, d, deleted)!.map((f) => f.stepPath)).toEqual([[1, 5]]);
    expect(remapAutoFixes(undefined, d, d)).toBeUndefined();
  });
});

describe('typed numbers', () => {
  it('reads distance in the unit beside the box', () => {
    expect(parseDistance('1.2', 'km')).toBe(1200);
    expect(parseDistance('1,5', 'km')).toBe(1500);
    expect(parseDistance('400', 'm')).toBe(400);
    expect(parseDistance('abc', 'km')).toBeNull();
    expect(parseDistance('0', 'm')).toBeNull();
  });

  it('reads time as m:ss anywhere, a bare number in the unit beside the box', () => {
    expect(parseTime('1:30', 'sec')).toBe(90);
    expect(parseTime('2.5', 'min')).toBe(150);
    expect(parseTime('45', 'sec')).toBe(45);
    expect(parseTime('1:05:00', 'min')).toBe(3900);
    expect(parseTime('0:00', 'min')).toBeNull();
    expect(parseTime('x', 'min')).toBeNull();
  });

  it('reads pace the way runners type it', () => {
    expect(parsePace('4:12')).toBe(252);
    expect(parsePace('4.12')).toBe(252);
    expect(parsePace('412')).toBe(252);
    expect(parsePace('4:5')).toBe(290);
    expect(parsePace('4:75')).toBeNull();
    expect(parsePace('15:00')).toBeNull();
  });

  it('shows the box value in its unit', () => {
    expect(durationBoxText({ durationType: 'distance', durationValue: 1200 }, 'km')).toBe('1.2');
    expect(durationBoxText({ durationType: 'distance', durationValue: 400 }, 'm')).toBe('400');
    expect(durationBoxText({ durationType: 'time', durationValue: 150 }, 'min')).toBe('2:30');
    expect(durationBoxText({ durationType: 'time', durationValue: 45 }, 'sec')).toBe('45');
  });
});
