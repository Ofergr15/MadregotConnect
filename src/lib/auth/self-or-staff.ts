import { NextResponse } from 'next/server';
import { isSuperUser } from '@/lib/constants';
import { createServerClient } from '@/lib/supabase/server';
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

/**
 * Resolves the caller's athlete row (if any) from the `x-user-email` header —
 * this app's established "self or staff" auth convention (see src/lib/api.ts's
 * authHeaders on the client side). This header is client-supplied and not
 * cryptographically verified, so it stops the app's own UI from acting as the
 * wrong person, but not a raw API call that forges the header.
 *
 * DEPRECATED for anything that matters — use `resolveVerifiedCaller` above.
 * The only remaining legitimate use is a caller that genuinely cannot hold a
 * bearer token, i.e. the service worker acting on a notification tap, which has
 * no access to the session in localStorage.
 */
export async function resolveCallerFromEmailHeader(
  request: Request,
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ email: string; isSuperUser: boolean; athlete: CallerAthlete | null }> {
  const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
  if (!email) return { email: '', isSuperUser: false, athlete: null };
  const { data } = await supabase.from('athletes').select('id, role').eq('email', email).maybeSingle();
  return {
    email,
    isSuperUser: isSuperUser(email),
    athlete: data ? { athleteId: data.id, role: data.role || null } : null,
  };
}
