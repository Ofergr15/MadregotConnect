import { NextResponse } from 'next/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { subscriptionsForAthletes, sendPushDetailed } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * Send a test push to the caller's own devices and report how many took it.
 *
 * The point is a self-service answer to "did my phone actually get that?".
 * Until now the only way to tell a working device from a silently dead
 * subscription was to query Postgres by hand — and the history table couldn't
 * help, because it recorded every notification as delivered whether or not any
 * device accepted it.
 *
 * Deliberately sent with NO `category`, so a muted preference can't make a
 * zero ambiguous: if this returns sent=0, the subscription is the problem.
 * `total` is included so 0-of-3 (dead endpoints) reads differently from
 * 0-of-0 (never subscribed on this device).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId: string | null = body?.athleteId || null;
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }
    // Self-or-staff: an athlete may test their own devices, staff may test
    // anyone's when helping someone debug.
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

    const subs = await subscriptionsForAthletes([athleteId]);
    if (subs.length === 0) {
      return NextResponse.json({ sent: 0, total: 0 });
    }

    const { sent } = await sendPushDetailed(subs, {
      title: 'בדיקת התראות ✅',
      body: 'ההתראות עובדות! אם קיבלת את זה, הכל מוגדר כמו שצריך.',
      url: '/dashboard/notifications',
      // Fresh tag per send so a second test isn't collapsed into the first —
      // a replaced notification looks like nothing arrived.
      tag: `push-test-${Date.now()}`,
      // A test that a mute could silence would answer the wrong question.
      badge: 0,
    });

    return NextResponse.json({ sent, total: subs.length });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
