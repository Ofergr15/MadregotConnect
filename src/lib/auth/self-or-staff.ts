import { isSuperUser } from '@/lib/constants';
import { createServerClient } from '@/lib/supabase/server';

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

/**
 * Resolves the caller's athlete row (if any) from the `x-user-email` header —
 * this app's established "self or staff" auth convention (see src/lib/api.ts's
 * authHeaders on the client side). This header is client-supplied and not
 * cryptographically verified, so it stops the app's own UI from acting as the
 * wrong person, but not a raw API call that forges the header — routes that
 * need real protection against that should use src/lib/auth-session.ts's
 * requireSession/requireAthlete instead.
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
