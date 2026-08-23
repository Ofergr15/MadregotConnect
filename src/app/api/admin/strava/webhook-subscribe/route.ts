import { NextResponse } from 'next/server';
import { requireSession, authError } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://madregot-connect.vercel.app';

/**
 * One-time setup route: registers this app's Strava webhook subscription.
 * Strava allows exactly ONE active subscription per API application, and it
 * immediately GETs the callback_url to verify it (see strava/webhook's GET
 * handler) — so this only works AFTER the webhook route is deployed and
 * reachable, not from localhost. Run once; re-running is harmless (Strava
 * returns the existing subscription's id if one already exists — see GET
 * below to check before creating).
 *
 * Staff-only, POST-only (not a GET so it can't be triggered by accident/bots).
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
    const res = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        callback_url: `${APP_URL}/api/strava/webhook`,
        verify_token: verifyToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.errors || data.message || 'Subscription request failed', raw: data }, { status: res.status });
    }
    return NextResponse.json({ subscription: data });
  } catch (error) {
    console.error('Strava webhook subscribe failed:', error);
    return NextResponse.json({ error: 'Subscription request failed' }, { status: 500 });
  }
}

/** GET — check the current subscription (there can be at most one). */
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
    const res = await fetch(
      `https://www.strava.com/api/v3/push_subscriptions?client_id=${clientId}&client_secret=${clientSecret}`,
    );
    const data = await res.json().catch(() => ([]));
    return NextResponse.json({ subscriptions: data });
  } catch (error) {
    console.error('Strava webhook subscription lookup failed:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
