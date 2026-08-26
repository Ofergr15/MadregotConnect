import { NextResponse } from 'next/server';
import { unreadCountForAthlete } from '@/lib/push';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';
import { UUID_RE } from '@/lib/notifications/inbox';
import { canViewAthleteNotifications } from '@/lib/notifications/access';

export const dynamic = 'force-dynamic';

// GET /api/notifications/unread?athleteId=… → { count }
// Used by the foreground badge self-heal (setAppBadge when the app backgrounds).
// Auth matches the sibling /inbox route — this was the one route missed when
// that route was hardened (own athlete, staff, or super-user only).
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId || !UUID_RE.test(athleteId)) return NextResponse.json({ count: 0 });

    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    const isSuper = isSuperUser(email);
    let caller: { id: string; role: string } | null = null;
    if (!isSuper && email) {
      const supabase = createServerClient();
      const { data } = await supabase.from('athletes').select('id, role').eq('email', email).maybeSingle();
      caller = data as { id: string; role: string } | null;
    }
    if (!canViewAthleteNotifications({ isSuper, caller, athleteId })) {
      return NextResponse.json({ count: 0 });
    }

    const count = await unreadCountForAthlete(athleteId);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
