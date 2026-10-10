import { describe, it, expect } from 'vitest';
import { pickPlan, planRowsFilter, prefersPlan } from '@/lib/plans/scope';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('whose weekly plan a reader gets', () => {
  it('reads the group plan plus only the reader’s own rows', () => {
    expect(planRowsFilter(ME)).toBe(`athlete_id.is.null,athlete_id.eq.${ME}`);
    expect(planRowsFilter(null)).toBe('athlete_id.is.null');
    expect(planRowsFilter('x;drop')).toBe('athlete_id.is.null');
  });

  it('never picks another trainee’s personal week, even a pushed one', () => {
    const rows = [
      { athlete_id: null, status: 'draft', id: 'group' },
      { athlete_id: OTHER, status: 'pushed', id: 'other' },
    ];
    expect(pickPlan(rows, ME)?.id).toBe('group');
    expect(pickPlan(rows, null)?.id).toBe('group');
  });

  it('the reader’s own week wins over the group plan', () => {
    const rows = [
      { athlete_id: null, status: 'pushed', id: 'group' },
      { athlete_id: ME, status: 'draft', id: 'mine' },
    ];
    expect(pickPlan(rows, ME)?.id).toBe('mine');
  });

  it('within the same kind, pushed wins over a draft', () => {
    expect(prefersPlan({ athlete_id: null, status: 'pushed' }, { athlete_id: null, status: 'draft' }, ME)).toBe(true);
    expect(prefersPlan({ athlete_id: null, status: 'draft' }, { athlete_id: null, status: 'pushed' }, ME)).toBe(false);
  });

  it('no rows → no plan', () => {
    expect(pickPlan([], ME)).toBeUndefined();
  });
});
