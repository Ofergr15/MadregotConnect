import { describe, expect, it } from 'vitest';
import { buildPublicProfile, type PublicProfileAthleteRow } from '@/lib/athletes/public-profile';

// Pure shaping tests for GET /api/athletes/[id]/public — the privacy-safe
// peer-facing profile. Asserts the exact projection: only id/name/avatarUrl/
// groupId/groupName/memberSince ever come out, regardless of what's on the
// raw athlete row (this is what keeps it distinct from the owner-only
// /api/athletes/me projection, which also returns email/onboarding-status/
// garmin-auth).

describe('buildPublicProfile', () => {
  const athlete: PublicProfileAthleteRow = {
    id: 'athlete-1',
    name: 'Dana Cohen',
    avatar_url: 'https://x/dana.png',
    group_id: 'group-1',
    created_at: '2026-01-15T00:00:00Z',
  };

  it('maps a full row + group to the exact camelCase contract shape', () => {
    const profile = buildPublicProfile(athlete, { name: 'Group A - SUB 2:30' });

    expect(profile).toEqual({
      id: 'athlete-1',
      name: 'Dana Cohen',
      avatarUrl: 'https://x/dana.png',
      groupId: 'group-1',
      groupName: 'Group 1', // canonicalized via groupDisplayName, same as /api/athletes
      memberSince: '2026-01-15T00:00:00Z',
    });
  });

  it('nulls out avatarUrl/groupId/groupName/memberSince when absent', () => {
    const bare: PublicProfileAthleteRow = {
      id: 'athlete-2',
      name: 'No Group',
      avatar_url: null,
      group_id: null,
      created_at: null,
    };
    const profile = buildPublicProfile(bare, null);

    expect(profile.avatarUrl).toBeNull();
    expect(profile.groupId).toBeNull();
    expect(profile.groupName).toBeNull();
    expect(profile.memberSince).toBeNull();
  });

  it('never includes email/onboarding-status/garmin-auth style fields', () => {
    const profile = buildPublicProfile(athlete, { name: 'Group B' });
    expect(Object.keys(profile).sort()).toEqual(
      ['avatarUrl', 'groupId', 'groupName', 'id', 'memberSince', 'name'].sort(),
    );
  });
});
