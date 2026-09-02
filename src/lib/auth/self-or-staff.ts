import { NextResponse } from 'next/server';
import { isSuperUser } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';

// Coach/admin-flavoured roles that may act on behalf of any athlete. Kept as
// the single source of truth — several routes each hand-rolled their own
// copy of this exact list before, and drifted (e.g. one included
// 'academy_coach', another didn't).
export const STAFF_ROLES = ['admin', 'coach', 'academy_coach'];

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export interface CallerAthlete {
  athleteId: string | null;
  role: string | null;
}

/**
 * The actual "may this caller act on targetAthleteId" decision — pure, so
 * it's cheap to unit-test independently of the DB lookup that feeds it.
 */
export function isSelfOrStaff(
  caller: CallerAthlete | null,
  targetAthleteId: string,
  callerIsSuperUser: boolean,
): boolean {
  if (callerIsSuperUser) return true;
  if (!caller) return false;
  if (caller.athleteId === targetAthleteId) return true;
  return isStaffRole(caller.role);
}

/** A caller whose identity came from a verified Supabase session. */
export interface VerifiedCaller {
  email: string;
  isSuperUser: boolean;
  /** True for admin/coach/academy_coach, incl. legacy `coaches`-only accounts. */
  isStaff: boolean;
  /** Null for a staff account with no `athletes` row. */
  athleteId: string | null;
}

/**
 * May this caller read or write `targetAthleteId`'s data?
 *
 * The verified-session counterpart of `isSelfOrStaff`. It takes `isStaff` as a
 * flag rather than a role string, because a legacy `coaches`-only account is
 * staff without having an `athletes` row to carry a role.
 */
export function mayActFor(
  caller: Pick<VerifiedCaller, 'isSuperUser' | 'isStaff' | 'athleteId'>,
  targetAthleteId: string,
): boolean {
  if (caller.isSuperUser || caller.isStaff) return true;
  return !!caller.athleteId && caller.athleteId === targetAthleteId;
}

/**
 * The verified replacement for `resolveCallerFromEmailHeader`: identity comes
 * from the Supabase JWT, so it cannot be forged by sending a different header.
 *
 * Returns `{ denied: Response }` to bail out with, or `{ denied: null, caller }`.
 * Pair it with `mayActFor` for the self-or-staff decision.
 */
export async function resolveVerifiedCaller(
  request: Request,
): Promise<{ denied: Response | null; caller: VerifiedCaller }> {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return {
      denied: authError(auth),
      caller: { email: '', isSuperUser: false, isStaff: false, athleteId: null },
    };
  }
  return {
    denied: null,
    caller: {
      email: auth.user.email,
      isSuperUser: isSuperUser(auth.user.email),
      isStaff: auth.user.isStaff,
      athleteId: auth.user.athleteId,
    },
  };
}

/**
 * The weakest real gate: any verified member of this club, staff or runner.
 *
 * For club-internal content that every athlete legitimately sees — the shared
 * weekly program, leaderboards, the planned-pace overlay on a teammate's run.
 * `requireSession` already rejects a valid Supabase user with no `athletes` or
 * `coaches` row, so this is "logged in AND belongs here", not merely "logged in".
 */
export async function requireMember(request: Request): Promise<Response | null> {
  const { denied } = await resolveVerifiedCaller(request);
  return denied;
}

/**
 * Staff-or-super-user gate for a route that isn't scoped to a single athlete —
 * club-wide coach views (team volume, the coach radar) and admin triage.
 * Returns a Response to bail out with, or null when the caller may proceed.
 *
 * Several routes hand-rolled this exact three-liner; new ones should use this.
 */
export async function requireStaff(request: Request): Promise<Response | null> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !caller.isStaff) {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  }
  return null;
}

/**
 * Gate for a route that acts on one athlete when given an id, and on the whole
 * club when not — the shape both activity-sync routes have. A non-staff caller
 * must name themselves; omitting the id means "sync everybody", so that's
 * staff-only.
 */
export async function requireCallerForAthlete(
  request: Request,
  targetAthleteId: string | null | undefined,
): Promise<{ denied: Response | null; caller: VerifiedCaller }> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };

  if (!targetAthleteId) {
    if (!caller.isSuperUser && !caller.isStaff) {
      return {
        denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }),
        caller,
      };
    }
    return { denied: null, caller };
  }

  if (!mayActFor(caller, targetAthleteId)) {
    return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

// `resolveCallerFromEmailHeader` lived here: it read the caller's identity from
// the client-supplied `x-user-email` header, which stopped the app's own UI from
// acting as the wrong person but not a raw API call that simply wrote a different
// address. It's gone because no route reads that header any more — every one of
// them resolves identity through `resolveVerifiedCaller` above. Deleted rather
// than left deprecated so it can't be reached for by the next route.
