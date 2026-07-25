import { PaceProfile } from './types';

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

export function getPaceForZone(
  zone: string,
  paceProfile: PaceProfile
): { min: number; max: number } {
  const key = zone as keyof PaceProfile;
  return paceProfile[key] || paceProfile.easy;
}
