import { groupDisplayName } from '@/lib/utils';
import { isCoreRunner } from '@/lib/core-runner';

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
  /** Migration 091's flag; `role` carries the legacy way of saying the same thing. */
  is_core_runner?: boolean | null;
  role?: string | null;
  is_academy?: boolean | null;
  academy_band_id?: string | null;
  academy_coach_id?: string | null;
}

export interface PublicProfileGroupRow {
  name: string | null;
}

/** A row of `academy_bands` — the goal band (דבוקה) an academy trainee trains for. */
export interface PublicProfileBandRow {
  band_number: number | null;
  name: string | null;
  goal: string | null;
}

/** The trainee's personal academy coach, by name only. */
export interface PublicProfileCoachRow {
  name: string | null;
}

export interface PublicAthleteBand {
  number: number | null;
  name: string | null;
  goal: string | null;
}

export interface PublicAthleteProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  groupId: string | null;
  groupName: string | null;
  memberSince: string | null;
  /** In the club's core squad (הגרעין) — drives the 🌰 mark next to the name. */
  isCoreRunner: boolean;
  isAcademy: boolean;
  /**
   * The academy goal band, and the personal coach's name.
   *
   * Both are null for anyone outside the academy, ON PURPOSE and by Ofer's
   * explicit instruction: only an academy trainee has a personal coach in this
   * system, so showing a coach — or a "no coach yet" placeholder — on a regular
   * member's profile would invent a relationship that doesn't exist. The rest of
   * the club's pace grouping is `groupName` above, which everyone has.
   */
  academyBand: PublicAthleteBand | null;
  coachName: string | null;
}

export function buildPublicProfile(
  athlete: PublicProfileAthleteRow,
  group: PublicProfileGroupRow | null,
  band: PublicProfileBandRow | null = null,
  coach: PublicProfileCoachRow | null = null,
): PublicAthleteProfile {
  const academy = athlete.is_academy === true;
  return {
    id: athlete.id,
    name: athlete.name,
    avatarUrl: athlete.avatar_url || null,
    groupId: athlete.group_id || null,
    groupName: group?.name ? groupDisplayName(group.name) : null,
    memberSince: athlete.created_at || null,
    isCoreRunner: isCoreRunner(athlete),
    isAcademy: academy,
    academyBand:
      academy && band
        ? { number: band.band_number ?? null, name: band.name ?? null, goal: band.goal ?? null }
        : null,
    coachName: academy ? coach?.name || null : null,
  };
}
