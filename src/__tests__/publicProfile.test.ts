import { describe, expect, it } from 'vitest';
import { buildPublicProfile, type PublicProfileAthleteRow } from '@/lib/athletes/public-profile';

// Pure shaping tests for GET /api/athletes/[id]/public — the privacy-safe
// peer-facing profile. Asserts the exact projection: only the identity,
// grouping and academy fields listed below ever come out, regardless of what's
// on the raw athlete row (this is what keeps it distinct from the owner-only
// /api/athletes/me projection, which also returns email/onboarding-status/
// garmin-auth).
//
// The academy cases are the load-bearing ones: the unified profile shows a
// personal coach and a goal band ONLY for an academy trainee, because nobody
// else has either, and inventing a coach for a regular member is worse than
// showing nothing.

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
      isCoreRunner: false,
      isAcademy: false,
      academyBand: null,
      coachName: null,
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
      [
        'academyBand',
        'avatarUrl',
        'coachName',
        'groupId',
        'groupName',
        'id',
        'isAcademy',
        'isCoreRunner',
        'memberSince',
        'name',
      ].sort(),
    );
  });

  it('exposes the band and the coach for an academy trainee', () => {
    const profile = buildPublicProfile(
      { ...athlete, is_academy: true },
      { name: 'Group A' },
      { band_number: 5, name: 'דבוקה 5', goal: '1:45 חצי' },
      { name: 'דורון פורת' },
    );
    expect(profile.isAcademy).toBe(true);
    expect(profile.academyBand).toEqual({ number: 5, name: 'דבוקה 5', goal: '1:45 חצי' });
    expect(profile.coachName).toBe('דורון פורת');
  });

  it('withholds the band and the coach for a non-academy athlete even when rows are passed', () => {
    // The caller shouldn't be loading these at all outside the academy, but the
    // shaping is the guarantee: a regular member has no personal coach in this
    // system, and a stale academy_coach_id left on their row must not resurface
    // as "your coach".
    const profile = buildPublicProfile(
      { ...athlete, is_academy: false, academy_coach_id: 'coach-1', academy_band_id: 'band-1' },
      { name: 'Group A' },
      { band_number: 5, name: 'דבוקה 5', goal: '1:45 חצי' },
      { name: 'דורון פורת' },
    );
    expect(profile.isAcademy).toBe(false);
    expect(profile.academyBand).toBeNull();
    expect(profile.coachName).toBeNull();
  });

  it('leaves the band null for an academy trainee not yet assigned to one', () => {
    const profile = buildPublicProfile({ ...athlete, is_academy: true }, null, null, { name: 'דורון פורת' });
    expect(profile.academyBand).toBeNull();
    expect(profile.coachName).toBe('דורון פורת');
  });

  it('reads הגרעין from the flag and from the legacy role', () => {
    // Two sources on purpose (migration 091 vs. the original role value) — the
    // 🌰 mark next to the name must appear for both.
    expect(buildPublicProfile({ ...athlete, is_core_runner: true }, null).isCoreRunner).toBe(true);
    expect(buildPublicProfile({ ...athlete, role: 'core_runner' }, null).isCoreRunner).toBe(true);
    expect(buildPublicProfile({ ...athlete, role: 'coach' }, null).isCoreRunner).toBe(false);
  });
});
