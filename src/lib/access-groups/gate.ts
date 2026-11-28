import { NextResponse } from 'next/server';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';

/**
 * Admin-only gate for /api/admin/access-groups/** and the per-user screen read.
 * Stricter than requireStaff on purpose (same reasoning as /api/admin/notifications):
 * a group decides who sees management screens, and one of the club's two coach
 * accounts is a `Test Coach` fixture. Identity is the JWT — a body never names the actor.
 */
export async function requireAdmin(
  request: Request, opts: { write?: boolean } = {},
): Promise<{ denied: Response | null; caller: VerifiedCaller }> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) {
    return { denied: NextResponse.json({ error: 'admin only' }, { status: 403 }), caller };
  }
  if (opts.write && caller.viewingAsBy) {
    return { denied: NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

export const actorOf = (c: VerifiedCaller) => c.athleteId ?? c.email;

export const pending = () =>
  NextResponse.json({ error: 'migration_pending', details: 'migration 226 not applied' }, { status: 503 });
