import { describe, expect, it } from 'vitest';
import { isStaffRole, isSelfOrStaff } from '@/lib/auth/self-or-staff';

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
