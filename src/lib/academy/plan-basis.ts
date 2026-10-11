import { resolveGroup } from '@/lib/utils';
import type { Lane } from './group-lane';

/**
 * Whose paces a plan week's steps are in, and the factor that restates them to the
 * trainee's — the rule week-board has always drawn by, shared now by everything that
 * PRICES a plan too (the home card, the ⚡ עומס צפוי of screen 4, the week's load tile, the
 * dashed bars, C2's projection).
 *
 *   - the trainee's OWN plan row is written at their own threshold: scale 1;
 *   - the club's week carries a squad lane's paces (lane 1's on a unified plan, else their
 *     group's lane), restated by `drawAtSec / referenceSec`.
 *
 * Without a test of their own there is nothing to restate TO: the steps are read as stored
 * (scale 1) and `DISPLAY_REFERENCE` only sizes the session for drawing.
 */

/** Restating paces needs A threshold; with no test, a typical one only sizes the session. */
export const DISPLAY_REFERENCE = 300;

export interface PlanBasis {
  fromClub: boolean;
  /** The threshold the stored paces were written for. */
  referenceSec: number;
  /** The one to draw and price them at. */
  drawAtSec: number;
  /** drawAtSec / referenceSec — the factor every stored pace is multiplied by. */
  scale: number;
}

export function planPaceBasis(input: {
  /** The plan row's athlete_id: set = the trainee's own week. */
  planAthleteId: string | null | undefined;
  parsedWorkouts: unknown;
  groupName: string | null | undefined;
  laneRefs: Record<Lane, number> | null;
  /** The trainee's threshold (sec/km), or null with no usable test. */
  thresholdSec: number | null;
}): PlanBasis {
  const own = input.thresholdSec && input.thresholdSec > 0 ? input.thresholdSec : null;
  if (input.planAthleteId || !input.laneRefs) {
    const ref = own ?? DISPLAY_REFERENCE;
    return { fromClub: !input.planAthleteId, referenceSec: ref, drawAtSec: ref, scale: 1 };
  }
  const unified = Array.isArray((input.parsedWorkouts as { workouts?: unknown } | null)?.workouts);
  const groupLane = resolveGroup(input.groupName ?? null).index + 1;
  const lane = (unified ? 1 : groupLane >= 1 ? groupLane : 1) as Lane;
  const referenceSec = input.laneRefs[lane];
  const drawAtSec = own ?? referenceSec;
  return { fromClub: true, referenceSec, drawAtSec, scale: referenceSec > 0 ? drawAtSec / referenceSec : 1 };
}
