import { describe, it, expect } from 'vitest';
import { formatPaceRange, groupPaceTokens, joinGroupPaces } from '@/lib/garmin/pace';

describe('formatPaceRange', () => {
  it('single pace when min===max', () => {
    expect(formatPaceRange(230, 230)).toBe('3:50');
  });
  it('range when min!==max', () => {
    expect(formatPaceRange(280, 330)).toBe('4:40–5:30');
  });
  it('single pace when only min given', () => {
    expect(formatPaceRange(250)).toBe('4:10');
  });
  it('empty when no pace', () => {
    expect(formatPaceRange(null, null)).toBe('');
    expect(formatPaceRange(0)).toBe('');
  });
});

describe('groupPaceTokens + joinGroupPaces', () => {
  it('builds "3:50 (4:00) ((4:10))" from three group paces', () => {
    const tokens = groupPaceTokens(
      { min: 230, max: 230 },
      { min: 240, max: 240 },
      { min: 250, max: 250 },
    );
    expect(tokens).toEqual(['3:50', '4:00', '4:10']);
    expect(joinGroupPaces(tokens)).toBe('3:50 (4:00) ((4:10))');
  });

  it('skips groups without a pace', () => {
    const tokens = groupPaceTokens({ min: 230, max: 230 }, null, null);
    expect(joinGroupPaces(tokens)).toBe('3:50');
  });

  it('handles ranges per group', () => {
    const tokens = groupPaceTokens(
      { min: 280, max: 330 },
      { min: 290, max: 340 },
      { min: 300, max: 350 },
    );
    expect(joinGroupPaces(tokens)).toBe('4:40–5:30 (4:50–5:40) ((5:00–5:50))');
  });
});
