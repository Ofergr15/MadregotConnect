import { describe, expect, it } from 'vitest';
import { isStaffRole, isSelfOrStaff, mayActFor } from '@/lib/auth/self-or-staff';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('isStaffRole', () => {
  it('accepts admin/coach/academy_coach', () => {
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('coach')).toBe(true);
    expect(isStaffRole('academy_coach')).toBe(true);
  });

  it('rejects runner/core_runner/viewer', () => {
    expect(isStaffRole('runner')).toBe(false);
    expect(isStaffRole('core_runner')).toBe(false);
    expect(isStaffRole('viewer')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

describe('isSelfOrStaff', () => {
  it('super user is always allowed, even with no caller record', () => {
    expect(isSelfOrStaff(null, OTHER, true)).toBe(true);
  });

  it('no caller (unresolved x-user-email) and not super user is denied', () => {
    expect(isSelfOrStaff(null, OTHER, false)).toBe(false);
  });

  it('caller acting on their own athleteId is allowed regardless of role', () => {
    expect(isSelfOrStaff({ athleteId: ME, role: 'runner' }, ME, false)).toBe(true);
  });

  it('staff caller acting on someone else is allowed', () => {
    expect(isSelfOrStaff({ athleteId: ME, role: 'coach' }, OTHER, false)).toBe(true);
  });

  it('non-staff caller acting on someone else is denied', () => {
    expect(isSelfOrStaff({ athleteId: ME, role: 'runner' }, OTHER, false)).toBe(false);
  });
});

// The verified-session counterpart. Same matrix, but staff arrives as a flag,
// because a legacy `coaches`-only account is staff with no athletes row to
// carry a role — the case isSelfOrStaff could not express.
describe('mayActFor', () => {
  const runner = { isSuperUser: false, isStaff: false, athleteId: ME };

  it('allows a runner on their own row', () => {
    expect(mayActFor(runner, ME)).toBe(true);
  });

  it('denies a runner on somebody else', () => {
    expect(mayActFor(runner, OTHER)).toBe(false);
  });

  it('allows staff on anyone', () => {
    expect(mayActFor({ isSuperUser: false, isStaff: true, athleteId: ME }, OTHER)).toBe(true);
  });

  it('allows a coaches-only staff account, which has no athleteId at all', () => {
    expect(mayActFor({ isSuperUser: false, isStaff: true, athleteId: null }, OTHER)).toBe(true);
  });

  it('allows the super user regardless of role or row', () => {
    expect(mayActFor({ isSuperUser: true, isStaff: false, athleteId: null }, OTHER)).toBe(true);
  });

  it('denies a signed-in account with no athlete row and no staff role', () => {
    expect(mayActFor({ isSuperUser: false, isStaff: false, athleteId: null }, OTHER)).toBe(false);
  });

  // Guards against a null==null match ever reading as "self".
  it('denies when both the caller and the target are unset', () => {
    expect(mayActFor({ isSuperUser: false, isStaff: false, athleteId: null }, '')).toBe(false);
  });
});
