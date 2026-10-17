import { describe, expect, it } from 'vitest';
import { strideMeters } from '@/components/activity/format';

describe('strideMeters', () => {
  it('reads the summaryDTO rows stored as cm×100', () => {
    expect(strideMeters(13792)).toBeCloseTo(1.38, 2);
    expect(strideMeters(11376)).toBeCloseTo(1.14, 2);
  });
  it('reads list rows stored in centimetres', () => {
    expect(strideMeters(137.9)).toBeCloseTo(1.38, 2);
  });
  it('passes metres through and drops nothing-values', () => {
    expect(strideMeters(1.2)).toBe(1.2);
    expect(strideMeters(0)).toBeNull();
    expect(strideMeters(null)).toBeNull();
  });
});
