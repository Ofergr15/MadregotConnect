import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Store (or refresh) a device's push subscription for an athlete.
export async function POST(request: Request) {
  try {
    const { athleteId, subscription, userAgent } = await request.json();
    if (!athleteId || !subscription?.endpoint || !subscription?.keys) {
      return NextResponse.json({ error: 'athleteId and subscription required' }, { status: 400 });
    }

    const supabase = createServerClient();
    // Upsert on endpoint (unique) so re-subscribing the same device updates keys
    // / re-points it at the current athlete rather than duplicating.
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          athlete_id: athleteId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          user_agent: userAgent || null,
          last_success_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );

    if (error) throw error;

    // Reap this device's orphans.
    //
    // subscribeToPush unsubscribes and creates a BRAND NEW endpoint each time
    // it runs, and nothing ever deleted the previous row — so pressing "enable
    // notifications" four times left four rows for one phone. That would be
    // merely untidy if dead endpoints reported themselves, but Apple answers
    // 201 for an endpoint that is still registered yet no longer bound to a
    // live service worker: the push is accepted and silently dropped, and the
    // 404/410 cleanup in sendPushToSubscriptions never fires. The orphans then
    // inflate every delivery count, which is exactly what disguised a total
    // delivery outage as "sent".
    //
    // Same athlete + same user_agent = same device, and a device has exactly
    // one live subscription. Only rows that have NOT been confirmed alive
    // recently are removed, so a genuine second device with an identical UA
    // string survives — its own heartbeat keeps last_success_at fresh.
    const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (userAgent) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('athlete_id', athleteId)
        .eq('user_agent', userAgent)
        .neq('endpoint', subscription.endpoint)
        .lt('last_success_at', staleBefore);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
