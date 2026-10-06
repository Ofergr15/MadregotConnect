// Who counts as an academy coach: the accounts the manager can hand a trainee to,
// and the ones the academy overview lists with their caseload.
//
// The `academy_coach` role, as the primary role or one of `extra_roles` (migration
// 127), plus anyone who already holds a trainee, so a caseload never goes missing
// from the list because a role was taken away later. It used to be every staff
// account, which put every admin and club coach into the picker and the load view.

export interface CoachCandidateRow {
  id: string;
  role?: string | null;
  extra_roles?: string[] | null;
}

export function holdsAcademyCoachRole(row: CoachCandidateRow): boolean {
  return row.role === 'academy_coach' || !!row.extra_roles?.includes('academy_coach');
}

/** The academy's coaches: role holders, and anyone a trainee is paired with. */
export function academyCoachIds(
  rows: CoachCandidateRow[],
  // `academy_coach_ids` is the whole set (lib/academy/trainee-coaches.ts) when the
  // caller has it; the legacy column alone otherwise.
  trainees: Array<{ academy_coach_id?: string | null; academy_coach_ids?: string[] }>,
): Set<string> {
  const ids = new Set(rows.filter(holdsAcademyCoachRole).map(r => r.id));
  for (const t of trainees) {
    if (t.academy_coach_id) ids.add(t.academy_coach_id);
    for (const c of t.academy_coach_ids ?? []) if (c) ids.add(c);
  }
  return ids;
}
