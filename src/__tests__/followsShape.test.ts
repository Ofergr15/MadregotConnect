import { describe, expect, it } from 'vitest';
import { buildConnectionsResult, type FollowAthleteRow } from '@/lib/follows/shape';

// Pure shaping tests for GET /api/athletes/[id]/connections. The route
// handler itself just does two Supabase lookups + an `.in()` batch fetch —
// this is the part with actual logic (counts, isFollowing derivation,
// snake_case -> camelCase mapping) worth unit-testing without a live DB.
// (Hitting the real route/DB isn't done here — this codebase's existing
// tests, e.g. src/__tests__/prBuckets.test.ts and awardEngine.test.ts, all
// test pure logic functions rather than live HTTP routes, so this follows
// that established pattern.)

describe('buildConnectionsResult', () => {
  const alice: FollowAthleteRow = { id: 'alice', name: 'Alice', avatar_url: 'https://x/alice.png' };
  const bob: FollowAthleteRow = { id: 'bob', name: 'Bob', avatar_url: null };
  const cara: FollowAthleteRow = { id: 'cara', name: 'Cara', avatar_url: null };

  it('computes accurate follower/following counts and maps rows to camelCase', () => {
    const result = buildConnectionsResult([alice, bob], [cara], null);

    expect(result.followerCount).toBe(2);
    expect(result.followingCount).toBe(1);
    expect(result.followers).toEqual([
      { id: 'alice', name: 'Alice', avatarUrl: 'https://x/alice.png' },
      { id: 'bob', name: 'Bob', avatarUrl: null },
    ]);
    expect(result.following).toEqual([{ id: 'cara', name: 'Cara', avatarUrl: null }]);
  });

  it('isFollowing is false when viewerId is omitted', () => {
    const result = buildConnectionsResult([alice], [], undefined);
    expect(result.isFollowing).toBe(false);
  });

  it('isFollowing is false when viewerId does not appear among the followers', () => {
    const result = buildConnectionsResult([alice], [], 'someone-else');
    expect(result.isFollowing).toBe(false);
  });

  it('isFollowing is true when viewerId appears among the followers', () => {
    const result = buildConnectionsResult([alice, bob], [], 'bob');
    expect(result.isFollowing).toBe(true);
  });

  it('returns zero counts and false isFollowing for an athlete with no connections', () => {
    const result = buildConnectionsResult([], [], 'anyone');
    expect(result).toEqual({
      followerCount: 0,
      followingCount: 0,
      isFollowing: false,
      followers: [],
      following: [],
    });
  });
});
