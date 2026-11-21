// The production default for name-only adoption on this branch is 'never'. No
// environment variable or runtime switch can change it.
import { describe, it, expect } from 'vitest';
import { NAME_ADOPTION_MODE, nameAdoptionRefusal } from '@/lib/auth/athlete-identity';

describe('name adoption default', () => {
  it("is 'never', a code constant", () => {
    expect(NAME_ADOPTION_MODE).toBe('never');
  });
  it('an ordinary, unlinked, unprivileged member is NOT adoptable by name with the default', () => {
    expect(nameAdoptionRefusal({ id: 'm', role: 'runner', strava_athlete_id: null }, 1, false)).toBe('name_only_disabled');
  });
});
