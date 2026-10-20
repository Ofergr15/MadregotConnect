import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authError, requireSession } from '@/lib/auth-session';
import { challengeFor, newVerifier } from '@/lib/auth/login-handoff';
import { INSTALL_KEY_TTL_MS } from '@/lib/auth/install-key';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/install-key → { verifier }
 *
 * "Install the app and already be signed in." An iPhone's home-screen app does not
 * share Safari's login, so a member who signed in with Strava in Safari would open
 * the icon to a sign-in screen. While they are still signed in here, this parks
 * their login in login_handoffs (the same single-use, PKCE-style row the Strava
 * sheet uses — lib/auth/login-handoff) and hands back the verifier. The install
 * step points the page's manifest at /api/public/manifest?k=<verifier>, so the icon
 * they add opens on /welcome?k=…, which claims it through /api/auth/claim-login.
 *
 * Only ever for the caller's own login, and only the hash is stored. The verifier
 * travels in the icon's address, so it is short-lived and spent on first use; a
 * key that expired or was used already falls back to the normal sign-in.
 */
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.email || !auth.user.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 400 });

  const verifier = newVerifier();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from('login_handoffs').insert({
    challenge: await challengeFor(verifier),
    auth_email: auth.user.email,
    expires_at: new Date(Date.now() + INSTALL_KEY_TTL_MS).toISOString(),
  });
  if (error) {
    console.error('install-key: insert failed', error);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  return NextResponse.json({ verifier }, { headers: { 'Cache-Control': 'no-store' } });
}
