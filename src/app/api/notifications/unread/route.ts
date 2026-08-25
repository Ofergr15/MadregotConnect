import { NextResponse } from 'next/server';
import { unreadCountForAthlete } from '@/lib/push';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/notifications/unread?athleteId=… → { count }
// Used by the foreground badge self-heal (setAppBadge when the app backgrounds).
// Auth matches the sibling /inbox route — this was the one route missed when
// that route was hardened (own athlete, staff, or super-user only).
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId || !UUID_RE.test(athleteId)) return NextResponse.json({ count: 0 });

    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    let allowed = false;
    if (isSuperUser(email)) {
      allowed = true;
    } else if (email) {
      const supabase = createServerClient();
      const { data: caller } = await supabase.from('athletes').select('id, role').eq('email', email).maybeSingle();
      const isStaff = !!caller && ['coach', 'admin', 'academy_coach'].includes((caller as { role: string }).role);
      allowed = isStaff || (caller as { id: string } | null)?.id === athleteId;
    }
    if (!allowed) return NextResponse.json({ count: 0 });

    const count = await unreadCountForAthlete(athleteId);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
