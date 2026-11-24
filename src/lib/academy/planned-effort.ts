import type { LibraryKind } from './library';

/**
 * The effort a session asks for, on the RPE 1–10 scale the trainee reports on (academy doc p.1 "מעקב מתאמן",
 * p.3 KPI "RPE בפועל מול המיועד"). Derived from the book's own kind for the session (book-steps `guessKind`), so
 * the planned effort and the book can't disagree. A band, not a number: RPE is a feeling, and a single planned
 * value would turn every honest 6 on a "5" day into a miss. Presentation only — nothing is graded or changed by it.
 */
export interface PlannedRpe { min: number; max: number }

export const PLANNED_RPE: Record<LibraryKind, PlannedRpe> = {
  easy: { min: 3, max: 4 },
  long: { min: 4, max: 5 },
  tempo: { min: 6, max: 7 },
  hills: { min: 7, max: 8 },
  intervals: { min: 8, max: 9 },
  test: { min: 9, max: 10 },
};

export function plannedRpeFor(kind: LibraryKind | null | undefined): PlannedRpe | null {
  return kind ? PLANNED_RPE[kind] ?? null : null;
}

/** Actual vs planned: 'below' | 'within' | 'above' (the band is inclusive). Null when either side is missing. */
export function rpeVsPlan(actual: number | null | undefined, planned: PlannedRpe | null): 'below' | 'within' | 'above' | null {
  if (actual == null || !Number.isFinite(actual) || !planned) return null;
  if (actual < planned.min) return 'below';
  if (actual > planned.max) return 'above';
  return 'within';
}
