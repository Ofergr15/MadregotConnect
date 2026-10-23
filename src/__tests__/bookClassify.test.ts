import { describe, expect, it } from 'vitest';
import { classifyWorkout } from '@/lib/academy/book-classify';

// The real entries the old guess got wrong (Ofer's book, 10-23).
describe('the book detects a session by its shape', () => {
  it('easy by minutes is easy, not long', () => {
    expect(classifyWorkout([{ kind: 'run', role: 'main', length: { measure: 'time', value: 3000 }, effort: null }], '50 דקות קל').kind).toBe('easy');
  });
  it('repeats in the name count when the steps lost them', () => {
    expect(classifyWorkout([], '17 × 500 מ׳ + 5 × 200 מ׳').kind).toBe('intervals');
    expect(classifyWorkout([], '6 × 9 דק׳').kind).toBe('tempo');
  });
  it('a long run with strides is a long run, and strides alone are easy', () => {
    expect(classifyWorkout([], 'ארוכה 24 ק״מ + 2 האצות').kind).toBe('long');
    expect(classifyWorkout([], 'קל 5.5 ק״מ + 10 × 100 מ׳ האצות').kind).toBe('easy');
  });
  it('tests and hills by the name', () => {
    expect(classifyWorkout([], 'טסט 5 ק״מ').kind).toBe('test');
    expect(classifyWorkout([], '10 × 40 שנ׳ עליות').kind).toBe('hills');
  });
  it('always says why', () => {
    expect(classifyWorkout([], '6 × 9 דק׳').reason).toMatch(/6 × 9 דק׳/);
  });
});
