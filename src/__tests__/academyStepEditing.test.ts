import { describe, expect, it } from 'vitest';
import {
  convertStep, duplicateStep, effortFromPace, effortFromZone, effortPace, insertStep, moveStep,
  paceSpread, removeStep, setMeasure, setPaceSpread, stepType, type BookStep,
} from '@/lib/academy/book-steps';
import { parseQuickText, quickToBook } from '@/lib/academy/quick-text';

/**
 * "A coach creating a workout needs EDITING too, not only auto-detection" (Ofer, 2026-10-19):
 * the parse is a first draft, and every step can be changed, added, removed, moved, doubled.
 */
const T = 300; // threshold 5:00/km
const steps: BookStep[] = [
  { kind: 'run', role: 'warmup', length: { measure: 'time', value: 900 }, effort: effortFromZone('easy') },
  { kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: effortFromPace(235, T), rest: { length: { measure: 'time', value: 120 }, mode: 'jog' } },
  { kind: 'run', role: 'cooldown', length: { measure: 'time', value: 600 }, effort: effortFromZone('easy') },
];

describe('every step can change', () => {
  it('names each step\'s type in the coach\'s words', () => {
    expect(steps.map(stepType)).toEqual(['warmup', 'interval', 'cooldown']);
  });
  it('turns a warm-up into a steady run, a run into intervals, intervals into one run of their volume', () => {
    expect(convertStep(steps, 0, 'steady')[0]).toMatchObject({ kind: 'run', role: 'main', length: { measure: 'time', value: 900 } });
    expect(convertStep(steps, 0, 'interval')[0]).toMatchObject({ kind: 'reps', count: 4, work: { measure: 'time', value: 900 } });
    expect(convertStep(steps, 1, 'steady')[1]).toMatchObject({ kind: 'run', role: 'main', length: { measure: 'distance', value: 5000 } });
    expect(convertStep(steps, 1, 'recovery')[1]).toMatchObject({ kind: 'rest', length: { measure: 'distance', value: 1000 } });
  });
  it('switches distance ↔ time at the step\'s own pace', () => {
    const t = setMeasure(steps, 1, 'time', T)[1] as Extract<BookStep, { kind: 'reps' }>;
    expect(t.work.measure).toBe('time');
    expect(t.work.value).toBe(240); // 1 km at 3:55 ≈ 4:00, rounded to 30 s
    const d = setMeasure(steps, 0, 'distance', T)[0] as Extract<BookStep, { kind: 'run' }>;
    expect(d.length).toMatchObject({ measure: 'distance' });
    expect(d.length!.value).toBeGreaterThan(2000);
  });
  it('gives a pace a range around the same centre, and takes it back', () => {
    const wide = setPaceSpread(steps, 1, 5, T);
    expect(paceSpread(wide[1], T)).toBe(5);
    expect(effortPace((wide[1] as Extract<BookStep, { kind: 'reps' }>).effort!, T)).toBeCloseTo(235, -0.5);
    expect(paceSpread(setPaceSpread(wide, 1, 0, T)[1], T)).toBe(0);
    expect(paceSpread(steps[1], T)).toBe(0);
  });
});

describe('steps can be added anywhere, removed, moved and doubled', () => {
  it('adds a step after any step, or at the top', () => {
    expect(insertStep(steps, 0, 'rest').map(stepType)).toEqual(['warmup', 'recovery', 'interval', 'cooldown']);
    expect(insertStep(steps, -1, 'run').map(stepType)).toEqual(['steady', 'warmup', 'interval', 'cooldown']);
  });
  it('removes, moves and duplicates, never touching the input', () => {
    const before = JSON.stringify(steps);
    expect(removeStep(steps, 1).map(stepType)).toEqual(['warmup', 'cooldown']);
    expect(moveStep(steps, 2, -1).map(stepType)).toEqual(['warmup', 'cooldown', 'interval']);
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(duplicateStep(steps, 1).map(stepType)).toEqual(['warmup', 'interval', 'interval', 'cooldown']);
    expect(JSON.stringify(steps)).toBe(before);
  });
});

describe('the parse never locks anything', () => {
  it('a parsed sentence is an editable model, edited like any other', () => {
    const parsed = parseQuickText('חימום 15 דק׳, 5×1 ק״מ ב־3:55 מנוחה 2 דק׳, שחרור 10');
    const book = quickToBook(parsed, T);
    expect(book.steps).not.toBeNull();
    const edited = duplicateStep(convertStep(book.steps!, 0, 'steady'), 1);
    expect(edited.map(stepType)).toEqual(['steady', 'interval', 'interval', 'cooldown']);
  });
});
