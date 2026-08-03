import { NextResponse } from 'next/server';
import { unreadCountForAthlete } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET /api/notifications/unread?athleteId=… → { count }
// Used by the foreground badge self-heal (setAppBadge when the app backgrounds).
export async function GET(request: Request) {
  try {
    const athleteId = new URL(request.url).searchParams.get('athleteId');
    if (!athleteId) return NextResponse.json({ count: 0 });
    const count = await unreadCountForAthlete(athleteId);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
