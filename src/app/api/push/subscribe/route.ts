import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// Store (or refresh) a device's push subscription for an athlete.
//
// Self-or-staff on `athleteId`. This one mattered more than it looks: the
// athleteId was taken from the request body and never checked, so a single
// POST could register YOUR device against someone else's id — and from then on
// their notifications, including the coach's one-on-one replies, would be
// delivered to your phone. Nothing in the app would have shown either of you
// that it had happened.
export async function POST(request: Request) {
  try {
    const { athleteId, subscription, userAgent, replacesEndpoint } = await request.json();
    if (!athleteId || !subscription?.endpoint || !subscription?.keys) {
      return NextResponse.json({ error: 'athleteId and subscription required' }, { status: 400 });
    }

    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

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

    // Retire the endpoint this one supersedes.
    //
    // subscribeToPush unsubscribes and creates a BRAND NEW endpoint each time
    // it runs, and nothing ever deleted the previous row — so pressing "enable
    // notifications" four times left four rows for one phone. That would be
    // merely untidy if dead endpoints reported themselves, but Apple answers
    // 201 for an endpoint that is still registered yet no longer bound to a
    // live service worker: the push is accepted and silently dropped, and the
    // 404/410 cleanup in sendPushDetailed never fires. The ghosts then inflate
    // every delivery count, which is exactly what disguised a total delivery
    // outage as "sent".
    //
    // The client names the endpoint it just discarded (`replacesEndpoint`),
    // because only the client knows. Two heuristics were tried and rejected:
    // matching on athlete + user_agent alone would delete a genuine second
    // device that reports an identical UA string (two same-model iPhones do),
    // and gating that on a stale `last_success_at` is inert precisely because
    // Apple's 201 keeps a ghost's timestamp looking fresh forever. Scoped to
    // this athlete so a stray endpoint string can't delete someone else's row.
    if (replacesEndpoint && replacesEndpoint !== subscription.endpoint) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('athlete_id', athleteId)
        .eq('endpoint', replacesEndpoint);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
