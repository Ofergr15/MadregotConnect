import { describe, expect, it } from 'vitest';
import { resolveNavItems } from '@/lib/nav-items';

/** "היום" is the runner's day; where /dashboard is the club in numbers, the tab says "מספרים" (2026-10-20). */
const label = (o: Parameters<typeof resolveNavItems>[0]) => resolveNavItems(o).find((i) => i.tab === 'dashboard')?.labelKey;

describe('the home tab name', () => {
  it('is "מספרים" for an admin with no athlete row, and for the operator account', () => {
    expect(label({ permissions: [], effectiveRole: 'admin', isAthlete: false })).toBe('numbersHome');
    expect(label({ permissions: [], effectiveRole: 'admin', isAthlete: true, isOperator: true })).toBe('numbersHome');
  });
  it('stays "היום" for an admin who runs, and for a runner', () => {
    expect(label({ permissions: [], effectiveRole: 'admin', isAthlete: true })).toBe('dashboard');
    expect(label({ permissions: [{ role: 'runner', tab: 'dashboard', enabled: true }] as never, effectiveRole: 'runner', isAthlete: true })).toBe('dashboard');
  });
});
