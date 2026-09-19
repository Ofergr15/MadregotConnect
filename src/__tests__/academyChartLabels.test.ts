import { describe, expect, it } from 'vitest';
import { labelledIndexes, monthLabel } from '@/components/academy/ImprovementChart';

/**
 * The improvement graph's x axis. Two defects found by reading the 375px screenshot, and
 * neither one is visible to the audit's measured rules — a clipped label is still a
 * legible-sized label, and an ambiguous date is a correctly rendered date.
 */

describe('monthLabel', () => {
  it('names the month, so it cannot be read as a day', () => {
    // `09.26` was the old format, on a card whose table prints the same test as `15.09.26`.
    // Two dot-separated dates in two different orders, three centimetres apart.
    expect(monthLabel('2026-09-14')).toBe('ספט׳ 26');
    expect(monthLabel('2026-02-18')).toBe('פבר׳ 26');
    expect(monthLabel('2027-01-03')).toBe('ינו׳ 27');
    expect(monthLabel('2026-12-31')).toBe('דצמ׳ 26');
  });
});

describe('labelledIndexes', () => {
  it('labels every test while they still fit', () => {
    // The club's four-test history — the case the card was designed around.
    expect([...labelledIndexes([40, 150, 260, 370])].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('keeps both ends, because they are the span the headline quotes', () => {
    // "27 seconds per km faster over 7 months" is a claim about the first and last test.
    const kept = labelledIndexes([40, 55, 70, 85, 100, 115, 130, 145, 160]);
    expect(kept.has(0)).toBe(true);
    expect(kept.has(8)).toBe(true);
  });

  it('thins the interior rather than overlapping two months into mush', () => {
    // Nine tests across the same 330px card: labelling all of them draws 42px of text every
    // 15px. Two tests in one month would print the same text twice, side by side.
    const xs = Array.from({ length: 9 }, (_, i) => 40 + i * 15);
    const kept = [...labelledIndexes(xs)].sort((a, b) => a - b);
    for (let i = 1; i < kept.length; i++) {
      expect(xs[kept[i]] - xs[kept[i - 1]]).toBeGreaterThanOrEqual(48);
    }
  });

  it('never leaves an interior label crowding the last one', () => {
    // The end is drawn unconditionally, so an interior label 5px short of it would collide
    // with something that cannot move out of the way.
    const kept = labelledIndexes([40, 88, 136, 141]);
    expect(kept.has(2)).toBe(false);
    expect(kept.has(3)).toBe(true);
  });

  it('handles one test and none at all without inventing a label', () => {
    expect([...labelledIndexes([200])]).toEqual([0]);
    expect([...labelledIndexes([])]).toEqual([]);
  });
});
