import { describe, expect, it } from 'vitest';
import { DAY_SESSION_EXIT_HREF, daySessionExitTarget } from '@/lib/day-session/exit';

describe('daySessionExitTarget', () => {
  it('goes to the coach tools when the flow is the first page (push deep link)', () => {
    expect(daySessionExitTarget(1)).toBe(DAY_SESSION_EXIT_HREF);
    expect(daySessionExitTarget(0)).toBe('/dashboard/coach-tools');
  });
  it('goes back when there is in-app history', () => {
    expect(daySessionExitTarget(2)).toBe('back');
    expect(daySessionExitTarget(12)).toBe('back');
  });
});
