import { describe, expect, it } from 'vitest';
import { isMissingMatchesTable } from '@/lib/plans/match-athlete-activities';

describe('isMissingMatchesTable', () => {
  it('detects the PostgREST missing-table error', () => {
    expect(
      isMissingMatchesTable({
        code: 'PGRST205',
        message: "Could not find the table 'public.activity_plan_matches' in the schema cache",
      }),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isMissingMatchesTable({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
