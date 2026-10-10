import { describe, expect, it } from 'vitest';
import {
  effortFromPace, effortFromZone, effortPace, fieldValue, nudgeField, setField, toLibrarySteps, wheelOptions,
  type BookStep,
} from '../lib/academy/book-steps';
import { parseQuickText, quickToBook } from '../lib/academy/quick-text';
import { resolveLibraryWorkout } from '../lib/academy/library';
import { applyPaceAdjust, mainPaceOf } from '../lib/academy/coach-tools';
import { kindShift, unshiftPace, type PaceAdjust } from '../lib/academy/pace-kinds';
import type { ParsedWorkout } from '../lib/ai/types';

// The book's day flow under a coach's pace update: what a screen shows is what is sent.

const T = 270;
const A: PaceAdjust = { reps: -7, tempo: -6 };
const model: BookStep[] = [
  { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: effortFromZone('easy') },
  { kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 }, effort: effortFromPace(245, T), rest: { length: { measure: 'time', value: 120 }, mode: 'jog' } },
];
const sent = (m: BookStep[], adjust = A) => applyPaceAdjust(resolveLibraryWorkout({ name: 'x', notes: null, steps: toLibrarySteps(m) }, { thresholdPaceSec: T, dayOfWeek: 2 })!, T, adjust);
const repRef = { step: 1, field: 'pace' as const };

describe('book paces under a pace update', () => {
  it('no update = exactly the numbers of before', () => {
    const e = model[1].kind === 'reps' ? model[1].effort! : null!;
    expect(effortPace(e, T, {})).toBe(effortPace(e, T));
    expect(effortPace(e, T, null)).toBe(effortPace(e, T));
    expect(fieldValue(model, repRef, T, {})).toBe(fieldValue(model, repRef, T));
    expect(JSON.stringify(setField(model, repRef, 240, T, {}))).toBe(JSON.stringify(setField(model, repRef, 240, T)));
    expect(wheelOptions(model, repRef, T, {})).toEqual(wheelOptions(model, repRef, T));
    expect(JSON.stringify(quickToBook(parseQuickText('5x1000 ב־4:05'), T, {}))).toBe(JSON.stringify(quickToBook(parseQuickText('5x1000 ב־4:05'), T)));
  });

  it('the rep pace shown moves by the update, and equals the pace sent', () => {
    expect(fieldValue(model, repRef, T, A)).toBe(238);
    expect(mainPaceOf(sent(model))).toBe(238);
    // Easy is not moved.
    expect(fieldValue(model, { step: 0, field: 'pace' }, T, A)).toBe(fieldValue(model, { step: 0, field: 'pace' }, T));
  });

  it('a pace set on the wheel or nudged is the pace the watch gets', () => {
    const set = setField(model, repRef, 236, T, A);
    expect(fieldValue(set, repRef, T, A)).toBe(236);
    expect(mainPaceOf(sent(set))).toBe(236);
    const nudged = nudgeField(model, repRef, 1, T, A);
    expect(fieldValue(nudged, repRef, T, A)).toBe(243);
    expect(wheelOptions(model, repRef, T, A)).toContain(238);
  });

  it('a typed pace in "הבנתי כך" is kept as typed after the update', () => {
    const book = quickToBook(parseQuickText('2 קל, 5x1000 ב־3:58 מנוחה 2:00, 2 קל'), T, A);
    const reps = book.steps.find(s => s.kind === 'reps')!;
    expect(reps.kind === 'reps' && effortPace(reps.effort!, T, A)).toBe(238);
    expect(mainPaceOf(sent(book.steps))).toBe(238);
  });

  it('one rule: the screens and the stored weeks classify a pace the same way', () => {
    expect(kindShift(245, T, A)).toBe(-7);
    expect(kindShift(272, T, A)).toBe(-6);
    expect(kindShift(330, T, A)).toBe(0);
    expect(unshiftPace(238, T, A)).toBe(245);
    expect(unshiftPace(330, T, A)).toBe(330);
  });

  it('the sent workout carries the marker, and a second update moves it by the difference only', () => {
    const w = sent(model);
    expect(w.paceAdjust).toEqual(A);
    expect(applyPaceAdjust(w, T, A)).toBe(w);
    expect(mainPaceOf(applyPaceAdjust(w, T, { reps: -10, tempo: -6 }))).toBe(235);
  });

  it('a re-resolved session keeps its name, description and shape', () => {
    const w: ParsedWorkout = { ...sent(model, {}), name: '5 × 1 ק״מ', description: 'האחרונה הכי חזקה' };
    const out = applyPaceAdjust(w, T, A);
    expect(out.name).toBe('5 × 1 ק״מ');
    expect(out.description).toBe('האחרונה הכי חזקה');
    expect(out.steps[1].repeatCount).toBe(5);
    expect(out.steps.map(s => s.type)).toEqual(w.steps.map(s => s.type));
  });
});
