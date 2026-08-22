import { groupDisplayName } from '@/lib/utils';

/**
 * Pure shaping for GET /api/athletes/[id]/public — the privacy-safe,
 * peer-facing profile. Deliberately NOT the same projection as
 * /api/athletes/me (owner-only; leaks email/onboarding-status/garmin-auth) —
 * this only ever exposes what's safe for any other club member to see.
 */

export interface PublicProfileAthleteRow {
  id: string;
  name: string;
  avatar_url: string | null;
  group_id: string | null;
  created_at: string | null;
}

export interface PublicProfileGroupRow {
  name: string | null;
}

export interface PublicAthleteProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  memberSince: string | null;
}

export function buildPublicProfile(
  athlete: PublicProfileAthleteRow,
  group: PublicProfileGroupRow | null,
): PublicAthleteProfile {
  return {
    id: athlete.id,
    name: athlete.name,
    avatarUrl: athlete.avatar_url || null,
    groupId: athlete.group_id || null,
    groupName: group?.name ? groupDisplayName(group.name) : null,
    memberSince: athlete.created_at || null,
  };
}
