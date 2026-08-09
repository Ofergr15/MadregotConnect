import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';

/** Verified-identity helpers for the social feed routes. */

export interface SessionUser {
  email: string;
  /** Athlete row id — null for a staff account that has no `athletes` row. */
  athleteId: string | null;
  name: string;
  role: string;
  groupId: string | null;
  athleteStatus: string | null;
  isStaff: boolean;
}

export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: number; error: string };

const STAFF_ROLES = ['admin', 'coach', 'academy_coach'];

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') || '';
  if (!/^bearer\s+/i.test(header)) return '';
  return header.replace(/^bearer\s+/i, '').trim();
}

/**
 * Resolve the caller from their Supabase JWT. Succeeds for any authenticated user,
 * including staff accounts that have no `athletes` row (legacy `coaches` records).
 * Use for reads.
 */
export async function requireSession(request: Request): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'Missing bearer token' };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, status: 500, error: 'Supabase not configured' };

  let email = '';
  try {
    const { data, error } = await createClient(url, anonKey).auth.getUser(token);
    if (error) return { ok: false, status: 401, error: 'Invalid or expired session' };
    email = (data?.user?.email || '').toLowerCase().trim();
  } catch {
    return { ok: false, status: 401, error: 'Could not verify session' };
  }
  if (!email) return { ok: false, status: 401, error: 'Session has no email' };

  const supabase = createServerClient();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, role, group_id, status')
    .eq('email', email)
    .maybeSingle();

  if (athlete) {
    const role = athlete.role || 'runner';
    return {
      ok: true,
      user: {
        email,
        athleteId: athlete.id,
        name: athlete.name || '',
        role,
        groupId: athlete.group_id || null,
        athleteStatus: athlete.status || null,
        isStaff: STAFF_ROLES.includes(role),
      },
    };
  }

  // Fallback for legacy staff that live only in `coaches` (same fallback order as
  // /api/auth/me).
  const { data: coach } = await supabase
    .from('coaches')
    .select('id, name, role')
    .eq('email', email)
    .maybeSingle();

  if (coach) {
    const role = coach.role || 'coach';
    return {
      ok: true,
      user: {
        email,
        athleteId: null,
        name: coach.name || '',
        role,
        groupId: null,
        athleteStatus: null,
        isStaff: true,
      },
    };
  }

  return { ok: false, status: 403, error: 'No membership found for this account' };
}

/**
 * Like `requireSession`, but additionally requires an ACTIVE athlete row — i.e. a
 * real club member who can be named as the author of a like, comment, or post.
 * Use for writes.
 */
export async function requireAthlete(
  request: Request,
): Promise<
  | { ok: true; user: SessionUser & { athleteId: string } }
  | { ok: false; status: number; error: string }
> {
  const result = await requireSession(request);
  if (!result.ok) return result;

  if (!result.user.athleteId) {
    return { ok: false, status: 403, error: 'This account has no athlete profile' };
  }

  if (result.user.athleteStatus !== 'active') {
    return { ok: false, status: 403, error: 'Account is not active' };
  }

  return { ok: true, user: { ...result.user, athleteId: result.user.athleteId } };
}

/** Standard error response for a failed auth check. */
export function authError(result: { status: number; error: string }): Response {
  return new Response(JSON.stringify({ error: result.error }), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
