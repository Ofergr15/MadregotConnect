import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';
import { APP_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** Where Strava must be told to deliver events for THIS deployment. */
const expectedCallback = () => `${APP_URL}/api/strava/webhook`;

/**
 * The subscriptions Strava currently holds for this application — at most one.
 * Shared by all three handlers, because every one of them has to know what is
 * already registered before it can say anything useful.
 */
async function listSubscriptions(clientId: string, clientSecret: string) {
  const res = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions?client_id=${clientId}&client_secret=${clientSecret}`,
  );
  const data = await res.json().catch(() => ([]));
  return Array.isArray(data) ? (data as Array<{ id: number; callback_url?: string }>) : [];
}

/** Drop one subscription. Returns whether Strava accepted it. */
async function deleteSubscription(clientId: string, clientSecret: string, id: number) {
  const res = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions/${id}?client_id=${clientId}&client_secret=${clientSecret}`,
    { method: 'DELETE' },
  );
  return res.ok;
}

/**
 * POST — point Strava's webhook at this deployment, repairing a wrong one.
 *
 * Strava allows exactly ONE active subscription per API application, and it
 * immediately GETs the callback_url to verify it (see strava/webhook's GET
 * handler) — so this only works AFTER the webhook route is deployed and
 * reachable, not from localhost. Safe to re-run: a subscription already pointing
 * here is left untouched.
 *
 * Staff-only. GET below is the read-only check, and the one to run first.
 */
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!clientId || !clientSecret || !verifyToken) {
    return NextResponse.json({ error: 'Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_WEBHOOK_VERIFY_TOKEN' }, { status: 500 });
  }

  try {
    // Strava allows one subscription per application, so a subscription pointing
    // at a retired domain cannot be moved — only replaced. Leaving it in place and
    // returning Strava's "already exists" is what let the webhook stay silent for
    // as long as it did, so this replaces it rather than reporting a conflict.
    const existing = await listSubscriptions(clientId, clientSecret);
    const want = expectedCallback();
    const alreadyRight = existing.find((s) => s.callback_url === want);
    if (alreadyRight) return NextResponse.json({ subscription: alreadyRight, unchanged: true });

    const removed: number[] = [];
    for (const stale of existing) {
      // Report the failure instead of pressing on into a create Strava is certain
      // to reject: a 200 with the stale subscription still in place is the exact
      // shape of silence this route exists to break.
      if (!(await deleteSubscription(clientId, clientSecret, stale.id))) {
        return NextResponse.json(
          { error: `Could not remove the existing subscription ${stale.id}; nothing changed.`, removed },
          { status: 502 },
        );
      }
      removed.push(stale.id);
    }

    const res = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        callback_url: want,
        verify_token: verifyToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.errors || data.message || 'Subscription request failed', removed, raw: data }, { status: res.status });
    }
    return NextResponse.json({ subscription: data, removed, callbackUrl: want });
  } catch (error) {
    console.error('Strava webhook subscribe failed:', error);
    return NextResponse.json({ error: 'Subscription request failed' }, { status: 500 });
  }
}

/**
 * GET — is the webhook actually pointed at us?
 *
 * A subscription registered against a URL the app no longer answers on is
 * indistinguishable from a healthy one from the inside: Strava goes on POSTing
 * events into the void, the app sees nothing, and nothing anywhere reports an
 * error. The only symptom is a member saying their runs don't arrive from Strava,
 * which is exactly what was reported (528e04a8). So this answers the question
 * rather than dumping JSON to be checked by eye.
 *
 * `healthy: true` means Strava holds one subscription and it targets this
 * deployment. `[]` means none was ever created; a mismatched `callback_url` means
 * events are going to a retired domain. POST repairs either.
 */
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET' }, { status: 500 });
  }

  try {
    const subscriptions = await listSubscriptions(clientId, clientSecret);
    const want = expectedCallback();
    const healthy = subscriptions.length === 1 && subscriptions[0]?.callback_url === want;
    return NextResponse.json({
      healthy,
      expectedCallback: want,
      subscriptions,
      // Spelled out, so reading the answer doesn't depend on knowing Strava's
      // one-subscription-per-application rule.
      diagnosis: healthy
        ? 'Strava is delivering events to this deployment.'
        : subscriptions.length === 0
          ? 'No subscription exists — Strava has nowhere to deliver events. POST here to create one.'
          : `Registered callback is ${subscriptions[0]?.callback_url}, which is not this deployment. POST here to replace it.`,
    });
  } catch (error) {
    console.error('Strava webhook subscription lookup failed:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}

/**
 * DELETE — unregister, so the subscription can be moved to another deployment.
 *
 * POST already replaces a wrong subscription on its own; this exists for the case
 * where the right answer is "no webhook here at all" (a preview deployment that
 * has stolen the subscription, an app being retired).
 */
export async function DELETE(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isStaff) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET' }, { status: 500 });
  }

  try {
    const existing = await listSubscriptions(clientId, clientSecret);
    const removed: number[] = [];
    for (const sub of existing) {
      if (await deleteSubscription(clientId, clientSecret, sub.id)) removed.push(sub.id);
    }
    return NextResponse.json({ removed, remaining: existing.length - removed.length });
  } catch (error) {
    console.error('Strava webhook unsubscribe failed:', error);
    return NextResponse.json({ error: 'Unsubscribe failed' }, { status: 500 });
  }
}
