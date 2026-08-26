import { describe, expect, it } from 'vitest';
import { canViewAthleteNotifications } from '@/lib/notifications/access';

describe('canViewAthleteNotifications', () => {
  it('the super user can always view, even with no caller row at all', () => {
    expect(canViewAthleteNotifications({ isSuper: true, caller: null, athleteId: 'alice' })).toBe(true);
  });

  it('an athlete can view their own notifications', () => {
    expect(canViewAthleteNotifications({
      isSuper: false,
      caller: { id: 'alice', role: 'runner' },
      athleteId: 'alice',
    })).toBe(true);
  });

  it("an athlete cannot view a different athlete's notifications", () => {
    // The exact bug this function was extracted to fix: /inbox used to be
    // wide open to any athleteId in the query string with zero auth check.
    expect(canViewAthleteNotifications({
      isSuper: false,
      caller: { id: 'alice', role: 'runner' },
      athleteId: 'bob',
    })).toBe(false);
  });

  it.each(['coach', 'admin', 'academy_coach'])('staff role "%s" can view any athlete', (role) => {
    expect(canViewAthleteNotifications({
      isSuper: false,
      caller: { id: 'staff-1', role },
      athleteId: 'someone-else',
    })).toBe(true);
  });

  it('an unrecognized role is treated as a regular athlete, not staff', () => {
    expect(canViewAthleteNotifications({
      isSuper: false,
      caller: { id: 'mystery-role-1', role: 'viewer' },
      athleteId: 'someone-else',
    })).toBe(false);
  });

  it('no caller row (unknown email) is denied unless super user', () => {
    expect(canViewAthleteNotifications({ isSuper: false, caller: null, athleteId: 'alice' })).toBe(false);
  });
});
