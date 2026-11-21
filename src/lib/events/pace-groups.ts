/**
 * Pace-group auto-suggestion for an event (Events v2). Pure — no DB, no clock.
 *
 * ## Formula
 *
 * Inputs: the event distance D (m), the runner's chosen goal band from the
 * questionnaire [goalMin, goalMax] (finish seconds), their latest half/full
 * marathon result (distance d, time t), and their 8-week average weekly km K.
 *
 * 1. **Goal time** G = midpoint of the chosen band.
 * 2. **Data-implied time** I (only when a HM/M result exists):
 *      I = t · (D / d)^1.06                          (Riegel)
 *          · (1 + volumePenalty)
 *    volumePenalty applies only to marathon-length targets (D ≥ 30 km):
 *      volumePenalty = min(0.06, max(0, 70 − K) · 0.001)
 *    i.e. +0.1% per weekly km under 70, capped at +6%. Riegel from a half to a full
 *    is known to be optimistic for low-mileage runners; this is the club's
 *    conservative correction, not a physiological model.
 * 3. **Mismatch** ⚠ when both exist and |G − I| / I > 2%.
 * 4. **Suggested time** S:
 *      - only G  → G
 *      - only I  → I
 *      - both, no mismatch → G (the runner's own choice)
 *      - both, mismatch    → max(G, I) — the slower one; a group that is too fast
 *                             is the failure that costs a race, and the coach
 *                             approves the final assignment anyway.
 * 5. **Group**: each group's finish F = pace · D / 1000. Pick the group with the
 *    smallest |F − S|; on a tie the slower group.
 */

export interface PaceGroup {
  id: string;
  label: string;
  targetPaceSecPerKm: number;
}

export interface SuggestInput {
  eventDistanceM: number;
  goalBand?: { minSec: number; maxSec: number } | null;
  latestResult?: { distanceM: number; timeSec: number; date?: string } | null;
  avgWeeklyKm8w?: number | null;
  groups: PaceGroup[];
}

export interface Suggestion {
  goalSec: number | null;
  impliedSec: number | null;
  suggestedSec: number | null;
  groupId: string | null;
  mismatch: boolean;
  /** (G − I) / I, signed; null without both. Negative = goal faster than data. */
  mismatchRatio: number | null;
}

export const MISMATCH_THRESHOLD = 0.02;
const RIEGEL_EXP = 1.06;

export function volumePenalty(eventDistanceM: number, avgWeeklyKm: number | null | undefined): number {
  if (eventDistanceM < 30000 || avgWeeklyKm == null || !Number.isFinite(avgWeeklyKm)) return 0;
  return Math.min(0.06, Math.max(0, 70 - avgWeeklyKm) * 0.001);
}

export function impliedFinishSec(
  eventDistanceM: number,
  result: { distanceM: number; timeSec: number },
  avgWeeklyKm: number | null | undefined,
): number {
  const riegel = result.timeSec * Math.pow(eventDistanceM / result.distanceM, RIEGEL_EXP);
  return riegel * (1 + volumePenalty(eventDistanceM, avgWeeklyKm));
}

export function groupFinishSec(group: PaceGroup, eventDistanceM: number): number {
  return (group.targetPaceSecPerKm * eventDistanceM) / 1000;
}

export function nearestGroup(groups: PaceGroup[], finishSec: number, eventDistanceM: number): PaceGroup | null {
  let best: PaceGroup | null = null;
  let bestDiff = Infinity;
  for (const g of groups) {
    const diff = Math.abs(groupFinishSec(g, eventDistanceM) - finishSec);
    if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) <= 1e-9 && best && g.targetPaceSecPerKm > best.targetPaceSecPerKm)) {
      best = g;
      bestDiff = diff;
    }
  }
  return best;
}

export function suggestPaceGroup(input: SuggestInput): Suggestion {
  const D = input.eventDistanceM;
  const goalSec =
    input.goalBand && input.goalBand.maxSec > 0 ? (input.goalBand.minSec + input.goalBand.maxSec) / 2 : null;
  const impliedSec =
    input.latestResult && input.latestResult.distanceM > 0 && input.latestResult.timeSec > 0 && D > 0
      ? impliedFinishSec(D, input.latestResult, input.avgWeeklyKm8w)
      : null;

  let mismatchRatio: number | null = null;
  let mismatch = false;
  if (goalSec != null && impliedSec != null) {
    mismatchRatio = (goalSec - impliedSec) / impliedSec;
    mismatch = Math.abs(mismatchRatio) > MISMATCH_THRESHOLD;
  }

  let suggestedSec: number | null = null;
  if (goalSec != null && impliedSec != null) suggestedSec = mismatch ? Math.max(goalSec, impliedSec) : goalSec;
  else suggestedSec = goalSec ?? impliedSec;

  const group = suggestedSec != null && D > 0 ? nearestGroup(input.groups, suggestedSec, D) : null;
  return {
    goalSec: goalSec != null ? Math.round(goalSec) : null,
    impliedSec: impliedSec != null ? Math.round(impliedSec) : null,
    suggestedSec: suggestedSec != null ? Math.round(suggestedSec) : null,
    groupId: group?.id ?? null,
    mismatch,
    mismatchRatio,
  };
}

/** "42.2K", "42.195 ק״מ", "Marathon", "21.1" → metres. Null when unreadable. */
export function parseDistanceM(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/half|חצי/.test(s)) return 21097.5;
  if (/marathon|מרתון/.test(s)) return 42195;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (Math.abs(n - 42.2) < 0.1 || Math.abs(n - 42.195) < 0.01) return 42195;
  if (Math.abs(n - 21.1) < 0.1 || Math.abs(n - 21.0975) < 0.01) return 21097.5;
  return n > 1000 ? n : n * 1000;
}

/** HM or marathon by distance, with GPS slack (watches read long). */
export function isHalfOrFull(distanceM: number): boolean {
  return (distanceM >= 20900 && distanceM <= 21700) || (distanceM >= 41900 && distanceM <= 43200);
}
