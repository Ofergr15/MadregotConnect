import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isAcademyManager } from '@/lib/academy/pairing-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/viewer — who the academy screen is drawn for. Normally the
 * signed-in account; while the super user views the academy as somebody
 * (lib/auth/view-as.ts) it is that person, which is how the screen picks the
 * coach's or the trainee's lens without /api/auth/me — and so the rest of the
 * app — ever changing hands.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const u = auth.user;
  return NextResponse.json({
    athleteId: u.athleteId,
    name: u.name,
    role: u.role,
    roles: u.roles ?? [u.role],
    isStaff: u.isStaff,
    isManager: isAcademyManager(u),
    viewingAs: !!u.viewingAsBy,
  });
}
