import { describe, expect, it } from 'vitest';
import {
  STAFF_ONLY_ATHLETE_FIELDS,
  denyAthleteWrite,
} from '@/lib/auth/athlete-write-scope';

const COACH = { isStaff: true, athleteId: 'coach-1' };
const STAFF_NO_ROW = { isStaff: true, athleteId: null }; // legacy `coaches`-only account
const RUNNER = { isStaff: false, athleteId: 'runner-1' };

describe('athlete write scope', () => {
  it('lets staff change anything on anyone', () => {
    expect(denyAthleteWrite(COACH, 'runner-1', ['groupId'])).toBeNull();
    expect(denyAthleteWrite(COACH, 'runner-1', ['status'])).toBeNull();
    expect(denyAthleteWrite(COACH, 'runner-1', ['isAcademy', 'groupId'])).toBeNull();
    expect(denyAthleteWrite(STAFF_NO_ROW, 'runner-1', ['status'])).toBeNull();
  });

  // The self-service case that keeps /dashboard/profile working.
  it('lets an athlete change their own group', () => {
    expect(denyAthleteWrite(RUNNER, 'runner-1', ['groupId'])).toBeNull();
  });

  it('refuses an athlete aiming at somebody else', () => {
    expect(denyAthleteWrite(RUNNER, 'runner-2', ['groupId'])).toBe('not_self');
    expect(denyAthleteWrite(RUNNER, 'runner-2', ['status'])).toBe('not_self');
  });

  // A suspended athlete must not be able to reinstate themselves, and nobody
  // may grant themselves academy access.
  it('refuses staff-only fields even on the athlete own row', () => {
    for (const field of STAFF_ONLY_ATHLETE_FIELDS) {
      expect(denyAthleteWrite(RUNNER, 'runner-1', [field])).toBe('staff_only_field');
      expect(denyAthleteWrite(RUNNER, 'runner-1', ['groupId', field])).toBe('staff_only_field');
    }
  });

  it('refuses a caller with no athlete row and no staff role', () => {
    expect(denyAthleteWrite({ isStaff: false, athleteId: null }, 'runner-1', ['groupId'])).toBe('not_self');
  });

  it('checks identity before fields, so the message never leaks who the target is', () => {
    expect(denyAthleteWrite(RUNNER, 'runner-2', ['isAcademy'])).toBe('not_self');
  });
});
