import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * A service worker reporting that it just displayed a push.
 *
 * This exists because the send side cannot tell delivery from acceptance.
 * web.push.apple.com answers 201 for an endpoint that is still registered but
 * no longer reaches a live service worker, and never 404/410s it — so a dead
 * subscription is indistinguishable from a working one from the server's side,
 * forever. Measured live: one athlete's four endpoints, three of them ghosts,
 * accepted 52 consecutive sends and displayed nothing, while 260 notification
 * rows recorded themselves as delivered.
 *
 * `push_subscriptions.last_success_at` is written ONLY here. That makes the
 * column mean what its name always promised — a device confirmed it showed
 * something — so a stale timestamp is real evidence of a ghost, which is what
 * /api/push/test reports and what the prune in /api/push/subscribe acts on.
 * (Kept under the existing name deliberately: renaming it would need a
 * hand-applied migration for a column whose meaning is now correct anyway.)
 *
 * "ONLY here" is load-bearing, not tidiness — /api/push/subscribe used to stamp
 * it too, which made a never-delivered endpoint indistinguishable from a
 * healthy one and would have made that prune delete the wrong rows. Anything
 * that writes this column outside this route breaks both.
 *
 * Unauthenticated by necessity: a service worker has no access to the Supabase
 * session (it lives in localStorage, in the page), and unlike the notification
 * action buttons there is no send-time payload to carry a signed token — the
 * receipt has to work for pushes sent before this route existed. The endpoint
 * URL is the credential: it is long, unguessable, and known only to the push
 * service and us. The blast radius of a stolen one is a single timestamp on a
 * single row moving forward, i.e. a ghost that manages to look alive — exactly
 * the status quo this route improves on. Nothing is read back, created, or
 * deleted here.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const endpoint: string | null = typeof body?.endpoint === 'string' ? body.endpoint : null;
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

    const supabase = createServerClient();
    const now = new Date().toISOString();
    await supabase
      .from('push_subscriptions')
      .update({ last_success_at: now })
      .eq('endpoint', endpoint);
    const { data: sub } = await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle();
    // Which push showed (lib/push-deliveries, migration 171): the push's own number and this
    // device. Only a row this endpoint was sent, and only once.
    const nid = typeof body?.nid === 'string' && /^[0-9a-f-]{36}$/i.test(body.nid) ? body.nid : null;
    const subId = (sub as { id?: string } | null)?.id;
    if (nid && subId) {
      await supabase.from('push_deliveries').update({ shown_at: now })
        .eq('nid', nid).eq('subscription_id', subId).is('shown_at', null);
    } else if (subId) {
      // A phone still on the service worker from before the number: its newest push of the
      // last 15 minutes that is not confirmed yet — what it just showed, near enough.
      const { data: last } = await supabase.from('push_deliveries').select('id')
        .eq('subscription_id', subId).eq('accepted', true).is('shown_at', null)
        .gte('sent_at', new Date(Date.now() - 15 * 60_000).toISOString())
        .order('sent_at', { ascending: false }).limit(1).maybeSingle();
      const id = (last as { id?: string } | null)?.id;
      if (id) await supabase.from('push_deliveries').update({ shown_at: now }).eq('id', id);
    }

    // 204 whether or not a row matched: the SW has nothing to do differently
    // either way, and not answering "is this endpoint known to you?" keeps the
    // route from being an oracle for anyone probing endpoint strings.
    return new NextResponse(null, { status: 204 });
  } catch {
    // Never surface a failure here as an error the SW might retry — a lost
    // receipt costs a "not confirmed" reading, and the notification already
    // showed regardless.
    return new NextResponse(null, { status: 204 });
  }
}
