// Whose weekly plan a reader gets (2026-10-10).
//
// `weekly_plans` holds two kinds of row under the same coach_id: the club's
// group plan (`athlete_id` null) and an academy trainee's personal week
// (`athlete_id` set, migration 019). The readers filtered on coach_id alone, so
// a trainee's personal week could be served to the whole club as "the plan" —
// and a dedupe that preferred any 'pushed' row made it the likely winner — while
// the trainee themself could get the group plan or nothing.
//
// The rule, in one place: a reader sees the group plan and their OWN personal
// rows, never anyone else's; for a given week their own row wins over the
// group's, and within the same kind a 'pushed' row wins over a draft.

import { looksLikeAthleteId } from '@/lib/auth/view-as';

/** PostgREST `or=` filter: the group plan, plus the reader's own rows. */
export function planRowsFilter(athleteId: string | null | undefined): string {
  return looksLikeAthleteId(athleteId) ? `athlete_id.is.null,athlete_id.eq.${athleteId}` : 'athlete_id.is.null';
}

type Row = { athlete_id?: string | null; status?: string | null };

/** Higher = preferred: own personal row, then pushed over draft. */
function rank(row: Row, athleteId: string | null | undefined): number {
  const own = !!athleteId && row.athlete_id === athleteId ? 2 : 0;
  return own + (row.status === 'pushed' ? 1 : 0);
}

/** Whether `candidate` should replace `current` as the week's plan for this reader. */
export function prefersPlan(candidate: Row, current: Row | undefined, athleteId: string | null | undefined): boolean {
  if (!current) return true;
  return rank(candidate, athleteId) >= rank(current, athleteId);
}

/** The best row of one week's rows for this reader, or undefined. */
export function pickPlan<T extends Row>(rows: T[] | null | undefined, athleteId: string | null | undefined): T | undefined {
  let best: T | undefined;
  for (const row of rows || []) {
    if (row.athlete_id && row.athlete_id !== athleteId) continue;
    if (prefersPlan(row, best, athleteId)) best = row;
  }
  return best;
}
