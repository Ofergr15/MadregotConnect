import { describe, expect, it } from 'vitest';
import { isCoreRunner, isLegacyCoreRunner, CORE_RUNNER_ROLE } from '@/lib/core-runner';

/**
 * הגרעין membership has TWO sources on purpose: the `is_core_runner` column
 * (migration 091) and the legacy `role = 'core_runner'` (migration 008), which is
 * still honoured so the code works before Ofer pastes 091 into the SQL editor and
 * so nobody needs re-tagging by hand.
 *
 * Every read path in the app goes through these two predicates, so the truth
 * table is worth pinning: getting it wrong either strips somebody's sponsor perks
 * or hands them out for free.
 */

describe('isCoreRunner', () => {
  it('reads the flag', () => {
    expect(isCoreRunner({ isCoreRunner: true })).toBe(true);
    expect(isCoreRunner({ is_core_runner: true })).toBe(true);
  });

  it('accepts either naming, because rows and sessions disagree', () => {
    // API responses are camelCase, raw Supabase rows are snake_case, and both are
    // handed to this function — hence the union rather than a mapping at 6 sites.
    expect(isCoreRunner({ is_core_runner: true, role: 'coach' })).toBe(true);
    expect(isCoreRunner({ isCoreRunner: true, role: 'coach' })).toBe(true);
  });

  it('still honours the legacy role before migration 091 is applied', () => {
    expect(isCoreRunner({ role: CORE_RUNNER_ROLE })).toBe(true);
  });

  it('is false for an ordinary member, and for missing subjects', () => {
    expect(isCoreRunner({ role: 'runner' })).toBe(false);
    expect(isCoreRunner({ role: 'coach', isCoreRunner: false })).toBe(false);
    expect(isCoreRunner(null)).toBe(false);
    expect(isCoreRunner(undefined)).toBe(false);
    expect(isCoreRunner({})).toBe(false);
  });

  it('treats an explicit false flag on a legacy role as still in', () => {
    // The flag defaults to false for every row, and 091's seed is what turns it on
    // for the legacy ones. Until that runs, `false` means "not migrated yet", NOT
    // "removed" — reading it as removal would silently drop the existing squad on
    // deploy. Removal goes through the API, which clears the role at the same time.
    expect(isCoreRunner({ role: CORE_RUNNER_ROLE, is_core_runner: false })).toBe(true);
  });
});

describe('isLegacyCoreRunner', () => {
  it('flags a row whose membership lives only in the role', () => {
    expect(isLegacyCoreRunner({ role: CORE_RUNNER_ROLE })).toBe(true);
    expect(isLegacyCoreRunner({ role: CORE_RUNNER_ROLE, is_core_runner: false })).toBe(true);
  });

  it('clears once the flag is set, even though the role is untouched', () => {
    // Migration 091 deliberately leaves `role` alone (rewriting it would swap
    // their tab permissions inside a supposedly additive migration), so a seeded
    // row carries BOTH — and is no longer legacy, because the flag now governs.
    expect(isLegacyCoreRunner({ role: CORE_RUNNER_ROLE, is_core_runner: true })).toBe(false);
  });

  it('is false for everyone else', () => {
    expect(isLegacyCoreRunner({ role: 'coach', is_core_runner: true })).toBe(false);
    expect(isLegacyCoreRunner({ role: 'runner' })).toBe(false);
    expect(isLegacyCoreRunner(null)).toBe(false);
  });

  it('never reports legacy for someone who is not in at all', () => {
    // The management screen offers a conversion for legacy rows, so a false
    // positive here would offer to "fix" an ordinary runner.
    for (const role of ['admin', 'coach', 'academy_coach', 'runner', 'viewer']) {
      expect(isLegacyCoreRunner({ role })).toBe(false);
    }
  });
});
