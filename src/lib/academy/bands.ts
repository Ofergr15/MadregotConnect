// The academy's goal bands (דבוקות) and the paces a trainee actually runs.
//
// Pure, Supabase-free and locale-driven, for the same reason as
// @/lib/academy/members: the route that validates an assignment and the
// components that render one must agree on what a valid band and offset are, and
// the planner has to resolve a trainee's paces the same way the directory
// displays them.
//
// The academy is coached online and 1:1, so what separates two trainees is not
// where or when they meet a coach — it is what they are training for. The
// registration form asks exactly that ("לאיזה דבוקה תרצה להשתייך", דבוקות 4-9)
// and each band is a goal: sub-3, around 3:30, finish a marathon, half prep,
// 5K/10K, from zero.
//
// Paces resolve in two tiers, which is the same shape the club already uses:
// the band supplies the offset so one edit moves everyone training for the same
// thing, and any individual trainee can be overridden without disturbing it.

import { paceLevelFromOffset, type PaceLevel } from '@/lib/groups/pace-level';

/**
 * A band's pace profile. Identical in shape to `groups.pace_profile`, so a band
 * and a club group can be read by one code path.
 *
 * `offsetSeconds` is seconds per km ADDED to the pace as written in the workout.
 * It is optional on purpose: a band whose paces nobody has set yet must be
 * distinguishable from one deliberately set to +0, because the planner refuses
 * to re-pace through an unset band rather than silently sending a sub-3 workout
 * to a beginner.
 */
export interface BandPaceProfile {
  marathonGoal?: string;
  offsetSeconds?: number;
  level?: PaceLevel;
}

/** A goal band as the API returns it. */
export interface AcademyBand {
  id: string;
  /** The number the trainee says out loud — "I'm in דבוקה 7". */
  bandNumber: number;
  name: string;
  /** The goal in the academy's own words, straight from the registration form. */
  goal: string | null;
  paceProfile: BandPaceProfile;
  /** How many academy trainees are currently in this band. */
  trainees?: number;
}

/**
 * How far a per-athlete override may sit from the written pace, in sec/km.
 *
 * Asymmetric because the realistic cases are: a little faster than their band
 * (-120 covers two minutes/km quicker, well past any real case), or a lot
 * slower — a true beginner against a marathon workout is minutes per km back.
 * Mirrors the CHECK constraint in migration 077.
 */
export const MIN_PACE_OFFSET_SEC = -120;
export const MAX_PACE_OFFSET_SEC = 600;

export function isValidPaceOffset(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= MIN_PACE_OFFSET_SEC
    && (value as number) <= MAX_PACE_OFFSET_SEC;
}

/**
 * The offset actually applied to this trainee's workouts, or null when it cannot
 * be resolved at all.
 *
 * Null is not zero, and the difference is a safety property. Zero means "runs at
 * the pace as written"; null means nobody has said what this trainee's paces are
 * — their band has no offset set and they have no override. The planner must
 * refuse to re-pace on null, because the alternative is pushing a workout
 * written for one goal onto an athlete training for a different one.
 */
export function effectiveOffsetSec(
  athleteOverrideSec: number | null | undefined,
  band: Pick<AcademyBand, 'paceProfile'> | null | undefined,
): number | null {
  if (typeof athleteOverrideSec === 'number') return athleteOverrideSec;
  const bandOffset = band?.paceProfile?.offsetSeconds;
  return typeof bandOffset === 'number' ? bandOffset : null;
}

/** Whether this trainee's paces are known well enough to plan for them. */
export function canResolvePaces(
  athleteOverrideSec: number | null | undefined,
  band: Pick<AcademyBand, 'paceProfile'> | null | undefined,
): boolean {
  return effectiveOffsetSec(athleteOverrideSec, band) !== null;
}

/** Where an offset came from — the UI says which, so a coach knows what an edit will move. */
export type OffsetSource = 'athlete' | 'band' | 'unset';

export function offsetSource(
  athleteOverrideSec: number | null | undefined,
  band: Pick<AcademyBand, 'paceProfile'> | null | undefined,
): OffsetSource {
  if (typeof athleteOverrideSec === 'number') return 'athlete';
  if (typeof band?.paceProfile?.offsetSeconds === 'number') return 'band';
  return 'unset';
}

export function bandLevel(band: Pick<AcademyBand, 'paceProfile'> | null | undefined): PaceLevel | null {
  const profile = band?.paceProfile;
  if (!profile) return null;
  if (profile.level) return profile.level;
  return typeof profile.offsetSeconds === 'number' ? paceLevelFromOffset(profile.offsetSeconds) : null;
}

/**
 * '+15' / '−8' / '0' — a signed sec/km offset for a pace column.
 *
 * Uses a real minus sign (U+2212) rather than a hyphen: these sit next to
 * Hebrew text in an RTL row, where a hyphen is easily read as punctuation or
 * swallowed by bidi reordering.
 */
export function fmtOffsetSec(sec: number): string {
  if (sec === 0) return '0';
  return sec > 0 ? `+${sec}` : `−${Math.abs(sec)}`;
}

/** Band order as the academy counts them — 4, 5, 6 … — with unbanded trainees last. */
export function sortBands(bands: AcademyBand[]): AcademyBand[] {
  return [...bands].sort((a, b) => a.bandNumber - b.bandNumber);
}

/**
 * Rows straight from `academy_bands` into the shape the client uses.
 *
 * Tolerates a non-object `pace_profile` because it is JSONB with a `{}` default
 * and nothing stops a hand-written SQL edit putting a string or null there.
 */
export function toBand(row: {
  id: string;
  band_number: number;
  name: string;
  goal?: string | null;
  pace_profile?: unknown;
}): AcademyBand {
  const raw = row.pace_profile;
  const profile: BandPaceProfile = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as BandPaceProfile)
    : {};
  return {
    id: row.id,
    bandNumber: row.band_number,
    name: row.name,
    goal: row.goal ?? null,
    paceProfile: profile,
  };
}
