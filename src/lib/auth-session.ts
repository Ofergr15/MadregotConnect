import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import {
  entryExpiry,
  isTokenExpired,
  resolveCached,
  tokenKey,
} from '@/lib/auth/session-cache';

export { invalidateToken, clearSessionCache } from '@/lib/auth/session-cache';

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
 *
 * Memoised per instance (see lib/auth/session-cache.ts) because this runs on
 * every authenticated request and costs two sequential remote round trips —
 * which a page firing 16 requests used to pay 16 times over for one session.
 * A verified result is reused for at most DEFAULT_TTL_MS, and never past the
 * token's own expiry, so a role change or deactivation takes effect within that
 * window rather than immediately; `invalidateToken` is there for the routes
 * that knowingly change what it says.
 */
export async function requireSession(request: Request): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, error: 'Missing bearer token' };

  // A token that says it has already expired can't be rescued by verifying it,
  // so fail here instead of spending a round trip to be told the same thing.
  if (isTokenExpired(token)) return { ok: false, status: 401, error: 'Invalid or expired session' };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, status: 500, error: 'Supabase not configured' };

  return resolveCached(
    tokenKey(token),
    entryExpiry(token),
    () => resolveSession(token, url, anonKey),
    (result) => result.ok,
  );
}

/** The uncached resolution: verify the JWT, then find the membership row. */
async function resolveSession(token: string, url: string, anonKey: string): Promise<AuthResult> {
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

  // NOT `.maybeSingle()`. That errors (PGRST116) on more than one row rather than
  // returning the first, and since the error is discarded here the row would read
  // as absent — so a single duplicated email would fall through to the coaches
  // lookup and 403 "No membership found" on EVERY authenticated route in the app.
  // Total lockout, from a data condition the app itself created for years.
  // Migration 079 makes duplicates impossible in a fresh database, but this is the
  // hottest path in the app and it should not depend on that.
  //
  // Prefer an active row, then the newest, which is how /api/auth/resolve-role
  // picks among duplicates too — so the athleteId in the session matches the one
  // sign-in handed the client.
  const { data: athleteRows } = await supabase
    .from('athletes')
    .select('id, name, role, group_id, status')
    .eq('email', email)
    .order('created_at', { ascending: false });

  const rows = athleteRows || [];
  const athlete = rows.find((r) => r.status === 'active') || rows[0];

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
  // /api/auth/me). Same reason as above for taking the first row rather than
  // .maybeSingle(): a duplicate must not read as "no such coach".
  const { data: coachRows } = await supabase
    .from('coaches')
    .select('id, name, role')
    .eq('email', email)
    .limit(1);

  const coach = (coachRows || [])[0];

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
