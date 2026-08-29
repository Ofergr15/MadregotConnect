import { NextResponse } from 'next/server';
import { canApprove } from '@/lib/constants';
import { authError, requireSession } from '@/lib/auth-session';

/**
 * Gate for the club-wide broadcast surfaces — the Notification Center, surveys,
 * and their image upload.
 *
 * All of them used to read the approver's address out of the request itself: an
 * `x-user-email` header, an `actorEmail` body field, a query param, a multipart
 * form field. None of those are verifiable, and APPROVER_EMAILS ships inside the
 * client bundle, so forging one was enough to push arbitrary text to every
 * athlete's phone. The actor is now the verified session email; whatever the
 * request claims is ignored.
 *
 * Returns `{ denied: Response }` to bail out with, or `{ denied: null, email }`
 * with the verified approver address to record as `created_by`.
 */
export async function requireApprover(
  request: Request,
): Promise<{ denied: Response | null; email: string }> {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth), email: '' };
  if (!canApprove(auth.user.email)) {
    return {
      denied: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }),
      email: '',
    };
  }
  return { denied: null, email: auth.user.email };
}
