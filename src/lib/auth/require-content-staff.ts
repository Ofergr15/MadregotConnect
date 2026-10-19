import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';

/**
 * Staff who run the club's content: the circles, celebrations, the session photos
 * (10-19). Not requireApprover: that is "may approve registrations", and a coach who
 * publishes need not be one, so the staff photos card answered 403.
 */
export async function requireContentStaff(request: Request): Promise<{ denied: Response | null; email: string; athleteId: string | null }> {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth), email: '', athleteId: null };
  const u = auth.user;
  if (!u.isSuperUser && !u.isStaff && !u.canApprove) {
    return { denied: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }), email: '', athleteId: null };
  }
  return { denied: null, email: u.email ?? '', athleteId: u.athleteId ?? null };
}
