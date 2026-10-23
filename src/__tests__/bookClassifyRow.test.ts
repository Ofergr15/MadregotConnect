import { describe, expect, it } from 'vitest';
import { classifyFacts, classifyShape, classifyWorkout } from '@/lib/academy/book-classify';

const row = (name: string) => { const c = classifyWorkout([], name); return { c, ...classifyFacts([], name, c), shape: classifyShape([], name, c.kind) }; };

describe('the review row (10-23)', () => {
  it('never repeats the title, says the work', () => {
    const r = row('10 × 2 דק׳ + 10 × 1 דק׳');
    expect(r.facts).toEqual(['30 דק׳ עבודה', 'חזרות של 1–2 דק׳']);
    expect(r.facts.join(' ')).not.toContain('10 × 2');
  });
  it('a 2-min rep is drawn twice as wide as a 1-min one', () => {
    const work = row('10 × 2 דק׳ + 10 × 1 דק׳').shape.filter((b) => b.tone !== 'gap' && b.tone !== 'e');
    expect(work).toHaveLength(20);
    expect(work[0].w).toBeCloseTo(work[19].w * 2);
  });
  it('12 × 1 ק״מ draws 12 work bars and its 5 strides', () => {
    const r = row('12 × 1 ק״מ + 5 × 150 מ׳');
    expect(r.facts[0]).toBe('12 ק״מ עבודה');
    expect(r.shape.filter((b) => b.tone === 'f')).toHaveLength(17);
  });
  it('no pace in the workout → by structure', () => expect(row('17 × 500 מ׳').pace).toBeNull());
});
