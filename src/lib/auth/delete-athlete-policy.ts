import { hasRole } from './roles';

/**
 * Who may DELETE an athlete row (`DELETE /api/athletes?id=`) — launch report BL9 / N8a.
 *
 * The route used to accept any staff session, so a plain academy coach could delete any
 * club member who was not a protected account (measured: 200). Deleting a person is a
 * club decision:
 *
 *  - the super user, an admin, an approver (`canApprove`), or a club `coach` (the club's
 *    own roster screen) — as before;
 *  - an academy MANAGER only for an applicant who was never let in: an unapproved
 *    `academy_pending` row (the club-forms banner's "דחייה והסרה");
 *  - nobody else — an `academy_coach` alone runs the trainees they were given and
 *    deletes no one.
 */
export interface DeleteCaller {
  isSuperUser: boolean;
  canApprove: boolean;
  role?: string | null;
  roles?: string[] | null;
}

export interface DeleteTarget {
  approved?: boolean | null;
  onboarding_status?: string | null;
}

export function mayDeleteAthlete(caller: DeleteCaller, target: DeleteTarget | null): boolean {
  if (caller.isSuperUser || caller.canApprove || hasRole(caller, 'admin') || hasRole(caller, 'coach')) return true;
  if (hasRole(caller, 'academy_manager')) {
    return !!target && target.approved === false && target.onboarding_status === 'academy_pending';
  }
  return false;
}
