/**
 * POST /api/photos/notify-import — staff-only.
 * Body: { date: string }
 *
 * Broadcasts "new photos are up" once an Import-tab run finishes a run date.
 * Nothing else in the photos pipeline ever tells athletes new photos exist —
 * without this, the only way to find out is opening Photos yourself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, isStaff } from '@/lib/auth/verify';
import { resolveAudience, sendPushToSubscriptions } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await verifyRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isStaff(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { date } = await req.json();
    if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

    const subs = await resolveAudience('all', null);
    let sent = 0;
    if (subs.length > 0) {
      sent = await sendPushToSubscriptions(subs, {
        title: '📸 תמונות חדשות עלו!',
        body: `תמונות מהריצה בתאריך ${date} זמינות לצפייה`,
        url: '/dashboard/photos?tab=browse',
        tag: `photos-import-${date}`,
        category: 'news',
      });
    }
    return NextResponse.json({ sent });
  } catch (error: unknown) {
    console.error('POST /api/photos/notify-import error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
