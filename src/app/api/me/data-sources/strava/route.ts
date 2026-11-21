import { NextResponse } from 'next/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { resolveStravaRedirectUri } from '@/lib/strava/client';
import { NATIVE_SCHEME, NATIVE_STRAVA_STATE_PREFIX } from '@/lib/data-sources/native';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/data-sources/strava — the authorize URL for the app's Strava sheet.
 * Self-only: the state is `app:<the JWT's athlete id>`, so the callback links the
 * caller's own row and then returns to `madregot://data-sources/strava`.
 * Scope is read-only (`activity:read_all` + `read`, which Strava always grants).
 */
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: resolveStravaRedirectUri(request),
    response_type: 'code',
    scope: 'read,activity:read_all',
    approval_prompt: 'auto',
    state: `${NATIVE_STRAVA_STATE_PREFIX}${auth.user.athleteId}`,
  });
  return NextResponse.json({
    authUrl: `https://www.strava.com/oauth/mobile/authorize?${p.toString()}`,
    callbackScheme: NATIVE_SCHEME,
  });
}
