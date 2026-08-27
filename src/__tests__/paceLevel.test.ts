import { describe, expect, it } from 'vitest';
import { paceLevelFromOffset } from '@/lib/groups/pace-level';

describe('paceLevelFromOffset', () => {
  it('returns fast at or below 0', () => {
    expect(paceLevelFromOffset(0)).toBe('fast');
    expect(paceLevelFromOffset(-10)).toBe('fast');
  });

  it('returns medium between 1 and 15', () => {
    expect(paceLevelFromOffset(1)).toBe('medium');
    expect(paceLevelFromOffset(15)).toBe('medium');
  });

  it('returns slow above 15', () => {
    expect(paceLevelFromOffset(16)).toBe('slow');
    expect(paceLevelFromOffset(30)).toBe('slow');
  });
});
