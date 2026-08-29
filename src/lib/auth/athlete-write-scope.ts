/**
 * Who may change what on an `athletes` row.
 *
 * PUT /api/athletes serves two genuinely different callers through one handler:
 * a coach on the athletes/academy screens editing anyone, and an athlete picking
 * their own group on /dashboard/profile. So the decision is per-field, not
 * per-route — and pure, so the matrix is unit-tested rather than reasoned about
 * at the call site.
 */

/** Fields an athlete must never set on their own row. */
export const STAFF_ONLY_ATHLETE_FIELDS = ['status', 'isAcademy'] as const;

export type AthleteWriteDenial =
  /** Non-staff caller aiming at somebody else's row. */
  | 'not_self'
  /** Non-staff caller touching a field only staff may set. */
  | 'staff_only_field';

export interface AthleteWriteCaller {
  isStaff: boolean;
  /** Null for a staff account with no `athletes` row — irrelevant when isStaff. */
  athleteId: string | null;
}

/**
 * Returns why the write should be refused, or null if it's allowed.
 *
 * `requestedFields` is the set of body keys actually present, so omitting a
 * staff-only field is fine but sending `status: undefined` explicitly is not
 * treated as a request to change it (the caller filters those out).
 */
export function denyAthleteWrite(
  caller: AthleteWriteCaller,
  targetAthleteId: string,
  requestedFields: readonly string[],
): AthleteWriteDenial | null {
  if (caller.isStaff) return null;
  if (!caller.athleteId || caller.athleteId !== targetAthleteId) return 'not_self';
  const staffOnly: readonly string[] = STAFF_ONLY_ATHLETE_FIELDS;
  if (requestedFields.some((f) => staffOnly.includes(f))) return 'staff_only_field';
  return null;
}

/** The message and status each denial maps to. */
export function athleteWriteError(denial: AthleteWriteDenial): { error: string; status: number } {
  return denial === 'not_self'
    ? { error: 'You can only update your own profile', status: 403 }
    : { error: 'Staff access required for this change', status: 403 };
}
