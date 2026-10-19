import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';

/** The birthday screens are the club admin's (Ofer, 2026-10-18): prepare, preview, switch on. */
export async function requireBirthdayAdmin(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) {
    return { denied: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), caller };
  }
  return { denied: null, caller };
}

/** The same gate, under the name the stories admin uses (admin role or super-user, server-side). */
export const requireStoryAdmin = requireBirthdayAdmin;
