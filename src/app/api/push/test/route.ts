import { NextResponse } from 'next/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { subscriptionsForAthletes, sendPushDetailed } from '@/lib/push';
import { createServerClient } from '@/lib/supabase/server';

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
 *
 * `confirmed` is the number of devices that reported displaying it (see
 * /api/push/receipt) — the only figure here that is actual evidence. `sent`
 * counts what the push service accepted, and Apple accepts sends to endpoints
 * that reach nothing, so sent=1 confirmed=0 is the exact signature of the ghost
 * subscription this whole path exists to catch.
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
      return NextResponse.json({ sent: 0, total: 0, confirmed: 0 });
    }

    // Snapshot the receipt timestamps BEFORE sending, so "confirmed" means a
    // receipt arrived for THIS test — not that the endpoint worked last week.
    const supabase = createServerClient();
    const ids = subs.map((s) => s.id);
    const { data: before } = await supabase
      .from('push_subscriptions')
      .select('id, last_success_at')
      .in('id', ids);
    const priorReceipt = new Map(
      (before || []).map((r) => [r.id as string, (r.last_success_at as string | null) ?? '']),
    );

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

    // Wait for the devices to report back. A receipt is a full round trip —
    // push service → phone → service worker → our API — so it needs a real
    // window, but one short enough to stay well inside the function timeout and
    // to feel like a button press. A locked or offline phone can miss the
    // window and still show the notification later, which is why the UI words a
    // zero here as "not confirmed", never as "failed".
    let confirmed = 0;
    if (sent > 0) {
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 700));
        const { data: after } = await supabase
          .from('push_subscriptions')
          .select('id, last_success_at')
          .in('id', ids);
        confirmed = (after || []).filter((r) => {
          const now = (r.last_success_at as string | null) ?? '';
          return now !== '' && now !== priorReceipt.get(r.id as string);
        }).length;
        if (confirmed >= sent) break;
      }
    }

    return NextResponse.json({ sent, total: subs.length, confirmed });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
