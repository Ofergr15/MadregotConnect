import { NextResponse } from 'next/server';
import { unreadCountForAthlete } from '@/lib/push';
import { UUID_RE } from '@/lib/notifications/inbox';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// GET /api/notifications/unread?athleteId=… → { count }
// Used by the foreground badge self-heal (setAppBadge when the app backgrounds).
// Auth matches the sibling /inbox route: own athlete, staff or super-user, from
// the verified session.
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId || !UUID_RE.test(athleteId)) return NextResponse.json({ count: 0 });

    // A denial is a real status, not `{ count: 0 }` — the caller sets the app
    // badge from this number, and a silent zero would wrongly clear it.
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!mayActFor(caller, athleteId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const count = await unreadCountForAthlete(athleteId);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
