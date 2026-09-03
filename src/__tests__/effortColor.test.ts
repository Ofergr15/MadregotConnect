import { describe, expect, it } from 'vitest';
import {
  effortColor,
  effortColorForHr,
  effortLevel,
  effortScale,
} from '@/lib/run-chat/effort-color';

describe('effortScale', () => {
  it('spans the lowest and highest lap heart rates', () => {
    expect(effortScale([119, 147, 166, 173, null, undefined])).toEqual({ lo: 119, hi: 173 });
  });

  it('is neutral for flat runs or missing data', () => {
    expect(effortScale([150, 152, 154])).toBeNull();
    expect(effortScale([150])).toBeNull();
    expect(effortScale([null, 0])).toBeNull();
  });
});

describe('effortColor', () => {
  const scale = { lo: 120, hi: 180 };

  it('maps easiest to green, middle to yellow, hardest to red', () => {
    expect(effortColorForHr(120, scale)).toBe('hsl(140 85% 62%)');
    expect(effortColorForHr(150, scale)).toBe('hsl(70 85% 62%)');
    expect(effortColorForHr(180, scale)).toBe('hsl(0 85% 62%)');
  });

  it('clamps outside the scale', () => {
    expect(effortLevel(90, scale)).toBe(0);
    expect(effortLevel(210, scale)).toBe(1);
    expect(effortColor(0.5)).toBe('hsl(70 85% 62%)');
  });

  it('returns null without a scale or heart rate', () => {
    expect(effortColorForHr(150, null)).toBeNull();
    expect(effortColorForHr(null, scale)).toBeNull();
  });
});
