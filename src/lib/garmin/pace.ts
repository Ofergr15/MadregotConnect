import { PaceProfile, StoredPaceProfile } from './types';

export function paceToMetersPerSecond(secondsPerKm: number): number {
  return 1000 / secondsPerKm;
}

export function metersPerSecondToPace(mps: number): string {
  const secondsPerKm = 1000 / mps;
  return formatPace(secondsPerKm);
}

export function parsePaceString(pace: string): number {
  const parts = pace.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return parseInt(pace);
}

export function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export interface GroupPace {
  min: number;
  max: number;
}

/** "3:40" for a single pace, "3:40–3:50" for a range. Empty string if no pace. */
export function formatPaceRange(min?: number | null, max?: number | null): string {
  if (!min) return '';
  if (max && max !== min) return `${formatPace(min)}–${formatPace(max)}`;
  return formatPace(min);
}

/**
 * The three per-group pace tokens (range-aware), in group order [g1, g2, g3].
 * Any group without a pace comes back as ''. Callers render/highlight each
 * token individually; use joinGroupPaces() for a plain combined string.
 */
export function groupPaceTokens(
  g1?: GroupPace | null,
  g2?: GroupPace | null,
  g3?: GroupPace | null,
): [string, string, string] {
  return [
    formatPaceRange(g1?.min, g1?.max),
    formatPaceRange(g2?.min, g2?.max),
    formatPaceRange(g3?.min, g3?.max),
  ];
}

/** The shape every renderer sees: a parsed step's own pace plus the two others. */
export interface PacedStep {
  targetType?: string;
  targetPaceMinPerKm?: number | null;
  targetPaceMaxPerKm?: number | null;
  group2Pace?: GroupPace | null;
  group3Pace?: GroupPace | null;
}

/**
 * The three pace tokens for one parsed step — `['3:45', '3:55', '4:05']`.
 *
 * Group ❶ lives on the step itself (`targetPaceMinPerKm`) while ❷/❸ hang off it
 * as `group2Pace`/`group3Pace`; three separate screens each re-derived that by
 * hand. `['', '', '']` means "this step has no pace" (a recovery jog, an
 * All-Out effort), which callers must render as *nothing* rather than as a dash
 * filling the pace column.
 */
export function stepPaceTokens(step: PacedStep): [string, string, string] {
  if (step.targetType === 'no_target' || !step.targetPaceMinPerKm) return ['', '', ''];
  return groupPaceTokens(
    { min: step.targetPaceMinPerKm, max: step.targetPaceMaxPerKm ?? step.targetPaceMinPerKm },
    step.group2Pace,
    step.group3Pace,
  );
}

/**
 * Club pace notation: Group 1 plain, Group 2 single brackets, Group 3 double
 * brackets — e.g. "3:30 (3:40) ((3:50))". Groups without a pace are skipped.
 */
export function joinGroupPaces(tokens: [string, string, string]): string {
  const [a, b, c] = tokens;
  const parts: string[] = [];
  if (a) parts.push(a);
  if (b) parts.push(`(${b})`);
  if (c) parts.push(`((${c}))`);
  return parts.join(' ');
}

export function getDefaultPaceProfile(): PaceProfile {
  return {
    easy: { min: 330, max: 390 },       // 5:30 - 6:30
    threshold: { min: 270, max: 290 },   // 4:30 - 4:50
    interval: { min: 240, max: 260 },    // 4:00 - 4:20
    tempo: { min: 280, max: 300 },       // 4:40 - 5:00
    sprint: { min: 200, max: 230 },      // 3:20 - 3:50
    marathon_pace: { min: 290, max: 310 }, // 4:50 - 5:10
  };
}

function isPaceRange(value: unknown): value is GroupPace {
  return !!value
    && typeof value === 'object'
    && typeof (value as GroupPace).min === 'number'
    && typeof (value as GroupPace).max === 'number';
}

/**
 * The pace range for a zone, or **null when the profile has none**.
 *
 * Null is the whole point. Every `pace_profile` row in production is an
 * `OffsetPaceProfile` (`{ marathonGoal, offsetSeconds }`) with no zone paces in
 * it, so this used to return `undefined` and its callers dereferenced `.min` —
 * a TypeError that failed an athlete's entire Garmin push and recorded it as a
 * cryptic delivery failure. It went unnoticed because the only caller that
 * supplies a real zone table is the test suite (`getDefaultPaceProfile()`).
 *
 * It returns null rather than falling back to a default table on purpose: these
 * numbers become a pace-zone alert on somebody's watch, and a club whose slowest
 * group is a sub-2:45 marathon has no use for a stock 5:30–6:30 "easy". A
 * missing pace must stay missing — the same rule `effectiveOffsetSec` follows in
 * `@/lib/academy/bands`, where null means "nobody has said what this athlete
 * runs" and the caller refuses rather than guesses.
 */
export function getPaceForZone(
  zone: string,
  paceProfile: StoredPaceProfile | null | undefined
): GroupPace | null {
  if (!paceProfile || typeof paceProfile !== 'object') return null;
  const table = paceProfile as Record<string, unknown>;
  const hit = table[zone];
  if (isPaceRange(hit)) return hit;
  // An unknown zone name on a genuine zone table still falls back to easy —
  // that predates this change, and mislabelling one zone is a different problem
  // from having no paces at all.
  return isPaceRange(table.easy) ? table.easy : null;
}
