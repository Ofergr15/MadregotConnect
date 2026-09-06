import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * How long an endpoint may go without one confirmed display before it counts as
 * a ghost and is pruned.
 *
 * Long on purpose. A receipt arrives whenever the service worker renders a push,
 * whether or not the app is open — so a reachable device keeps stamping itself
 * alive without its owner doing anything, and a month of silence means either
 * nothing was ever sent to it or nothing arrived. Erring short would break the
 * case notifications exist for: the athlete who has stopped opening the app is
 * exactly the one a notification is meant to reach, and keying the prune on
 * recent activity would delete their subscription for being inactive.
 *
 * Being wrong here is self-repairing anyway. A live device that gets pruned
 * re-registers itself on its next app open (PushOptIn's daily heal →
 * ensurePushSubscription → getSubscription → this route), with no prompt and no
 * user action. A ghost left in place is not self-repairing: it absorbs a 201 per
 * send, forever.
 */
const GHOST_STALE_DAYS = 30;

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
    //
    // Deliberately does NOT write `last_success_at`. Registering a subscription
    // is not evidence that anything was ever displayed on it, and stamping it
    // here quietly broke the one invariant /api/push/receipt documents — that
    // the column means "a device confirmed it showed something". The cost was
    // real and not theoretical: an endpoint created 2026-08-03 that never
    // delivered a single push carried a `last_success_at` equal to its own
    // `created_at`, which reads as a successful delivery, and it is the column
    // both /api/push/test and the prune below have to trust. A row whose
    // receipt equals its creation time is now, correctly, a row that has never
    // delivered.
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          athlete_id: athleteId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          user_agent: userAgent || null,
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
    // because only the client knows. Scoped to this athlete so a stray endpoint
    // string can't delete someone else's row.
    if (replacesEndpoint && replacesEndpoint !== subscription.endpoint) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('athlete_id', athleteId)
        .eq('endpoint', replacesEndpoint);
    }

    // Then the ghosts no client can name.
    //
    // `replacesEndpoint` above only works when the client still HELD the old
    // subscription and unsubscribed it. The way ghosts are actually created is
    // the opposite: iOS drops the subscription underneath the app (or the old
    // hardReload unregistered the worker), so by the time the athlete
    // re-enables there is nothing left to name and the dead row is orphaned
    // with no reference to it anywhere. Every ghost measured on 2026-09-06 got
    // there this way.
    //
    // So: no confirmed display in GHOST_STALE_DAYS, and old enough to have had
    // the chance. Two heuristics were tried before and are worth recording,
    // because one of them has since become correct and the other is worse than
    // it looks:
    //
    //   • Same athlete + same `user_agent` was rejected for deleting a genuine
    //     second same-model iPhone. It is also, less obviously, aimed away from
    //     its target — UA strings carry the iOS version, ghosts are old by
    //     definition, so an old row's UA has usually drifted. Live proof: the
    //     Aug 3 ghost reads `Version/26.5.2` where the working row on the same
    //     phone reads `Version/26.6.1`. A UA match would have skipped exactly
    //     the row it existed to remove.
    //   • A stale `last_success_at` was rejected as inert, because at the time
    //     the send path stamped it on every 2xx and Apple's 201 kept a ghost
    //     looking fresh forever. That is no longer true (see push.ts, and the
    //     upsert above), so the signal now works — it is the only one that
    //     distinguishes a dead endpoint from a live one at all.
    //
    // A NULL receipt counts as stale: post-fix that is a row that has genuinely
    // never delivered, and `created_at` keeps a newly registered device safe
    // until it has had a month to prove itself.
    //
    // Runs on registration rather than on a schedule, so it needs no cron and
    // fires at the one moment we have fresh truth about a device. The limit of
    // that: an athlete who never re-registers keeps their ghosts. They cost
    // inflated counts, not lost notifications, which is the right thing to
    // leave on the table.
    const cutoff = new Date(Date.now() - GHOST_STALE_DAYS * 86_400_000).toISOString();
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('athlete_id', athleteId)
      // Never the row just stored, whatever its timestamps say.
      .neq('endpoint', subscription.endpoint)
      .lt('created_at', cutoff)
      .or(`last_success_at.is.null,last_success_at.lt.${cutoff}`);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
