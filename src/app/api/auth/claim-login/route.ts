import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, signDeviceToken } from '@/lib/auth/device-token';
import { challengeFor } from '@/lib/auth/login-handoff';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/claim-login  { verifier }
 *
 * Collects a Strava login that finished somewhere this browser cannot see — iOS's
 * in-app browser sheet, which a standalone PWA is forced to open for a
 * cross-origin navigation and which has its own storage partition. The callback
 * parked the login in login_handoffs; this hands it to whoever holds the matching
 * verifier, which is only ever the app that started it.
 *
 * 404 is the normal, expected answer: the app polls on every foreground, and most
 * of the time there is nothing waiting. It must not be treated as a failure.
 */
export async function POST(req: NextRequest) {
  let verifier: unknown;
  try {
    ({ verifier } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const challenge = await challengeFor(verifier);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Claim and read in ONE statement. `claimed_at IS NULL` in the WHERE clause is
  // what makes the row single-use: two requests racing on the same verifier —
  // the foreground poll and a visibilitychange firing together, say — cannot both
  // match, so only one ever mints a session. A read-then-write would let both.
  const { data: claimed, error } = await admin
    .from('login_handoffs')
    .update({ claimed_at: new Date().toISOString() })
    .eq('challenge', challenge)
    .is('claimed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('auth_email')
    .maybeSingle();

  if (error) {
    // Includes "relation does not exist" until migration 082 is applied. Say
    // nothing useful to the caller; the app treats it the same as "nothing
    // waiting" and falls back to the normal login.
    console.error('claim-login: lookup failed', error);
    return NextResponse.json({ error: 'No pending login' }, { status: 404 });
  }
  if (!claimed?.auth_email) {
    return NextResponse.json({ error: 'No pending login' }, { status: 404 });
  }

  const session = await createSyntheticSession(admin, claimed.auth_email);
  if (session.error || !session.session) {
    // The row is already spent. Deliberate: a verifier that failed here must not
    // be retryable, or a bug in session minting becomes an unlimited retry
    // window on a login that was authorised minutes ago.
    console.error('claim-login: session mint failed', session.error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }

  const response = NextResponse.json({
    session: {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    },
  });

  // The whole point of the exercise: this cookie lands in the APP's partition,
  // so from here on /api/auth/silent-session can re-mint a session on its own
  // and the member never sees a login screen again.
  const deviceToken = signDeviceToken(claimed.auth_email);
  if (deviceToken) response.cookies.set(DEVICE_COOKIE, deviceToken, DEVICE_COOKIE_OPTIONS);
  return response;
}
