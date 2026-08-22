/**
 * Pure shaping helpers for the follow graph (athlete_follows, migration 060).
 * Kept separate from the route handlers (same split as src/lib/feed/project.ts
 * for feed items) so the response-shaping logic is unit-testable without a
 * live Supabase connection.
 */

/** Raw joined row shape coming back from a `.select('id, name, avatar_url')`. */
export interface FollowAthleteRow {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface FollowSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ConnectionsResult {
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  followers: FollowSummary[];
  following: FollowSummary[];
}

function mapFollowRow(row: FollowAthleteRow): FollowSummary {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url || null,
  };
}

/**
 * Builds the exact GET /api/athletes/[id]/connections response body from the
 * two raw row sets (athletes who follow the target, athletes the target
 * follows) plus the optional viewer id.
 *
 * `isFollowing` is derived by checking whether the viewer already appears in
 * `followerRows` — that list IS "everyone with a row where followee_id = the
 * target", so no second query is needed to answer "does the viewer follow
 * the target". Absent/unrecognized viewerId → false, per contract.
 */
export function buildConnectionsResult(
  followerRows: FollowAthleteRow[],
  followingRows: FollowAthleteRow[],
  viewerId?: string | null,
): ConnectionsResult {
  const followers = followerRows.map(mapFollowRow);
  const following = followingRows.map(mapFollowRow);

  return {
    followerCount: followers.length,
    followingCount: following.length,
    isFollowing: !!viewerId && followers.some((f) => f.id === viewerId),
    followers,
    following,
  };
}
