import type { ParsedWorkout } from '@/lib/ai/types';
import { absoluteToLibrary, fromLibrarySteps, structureName } from './book-steps';
import { restateSteps } from './load';
import type { PlanBasis } from './plan-basis';
import { plannedPaceOf, stepTiles, type StepTile } from './trainee-home';

/**
 * One row of the classic trainee home (/api/academy/me) in the TRAINEE's terms
 * (launch report BL3 / N3) — the rule /api/academy/week-board draws by.
 *
 * A week with no personal plan is graded against the club's (senior) week, whose
 * steps carry a squad lane's absolute paces: drawn as stored, a beginner read
 * "reps 3:05" next to "סף 4:41". So every pace that leaves this row — the planned
 * pace, the band a done run is compared to, today's step tiles — is restated by
 * `basis.scale` to the trainee's own threshold, and withheld entirely when they
 * have no threshold (no test → no pace, as week-board does). The title is the
 * session's structure (`6 × 800 מ׳`), not the club's weekday title (`ראשון`).
 */
export function traineePlanRow(input: {
  name: string;
  workout: Pick<ParsedWorkout, 'steps'> | null | undefined;
  plannedMin: number | null;
  plannedMax: number | null;
  comparedMin: number | null;
  comparedMax: number | null;
  basis: Pick<PlanBasis, 'scale' | 'referenceSec'> | null;
  thresholdSec: number | null;
}): {
  name: string;
  plannedPace: number | null;
  comparedMin: number | null;
  comparedMax: number | null;
  tiles: StepTile[] | null;
} {
  const scale = input.basis?.scale ?? 1;
  const has = !!(input.thresholdSec && input.thresholdSec > 0);
  const at = (sec: number | null) => (sec && sec > 0 ? (Math.abs(scale - 1) < 1e-9 ? sec : Math.round(sec * scale)) : null);
  const steps = input.workout?.steps ?? [];
  let name = input.name;
  if (steps.length && input.basis) {
    const model = fromLibrarySteps(absoluteToLibrary(steps, input.basis.referenceSec).steps);
    const structured = model ? structureName(model) : '';
    if (structured) name = structured;
  }
  const tiles = input.workout
    ? stepTiles({ steps: restateSteps(steps, scale) }).map((t) => (has ? t : { ...t, pace: null }))
    : null;
  return {
    name,
    plannedPace: has ? plannedPaceOf(at(input.plannedMin), at(input.plannedMax)) : null,
    comparedMin: has ? at(input.comparedMin) : null,
    comparedMax: has ? at(input.comparedMax) : null,
    tiles,
  };
}
