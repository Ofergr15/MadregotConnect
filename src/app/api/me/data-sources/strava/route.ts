import { NextResponse } from 'next/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { resolveStravaRedirectUri } from '@/lib/strava/client';
import { NATIVE_SCHEME } from '@/lib/data-sources/native';
import { createServerClient } from '@/lib/supabase/server';
import { reserveLinkState, signLinkState } from '@/lib/strava/link-state';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/data-sources/strava — the authorize URL for the app's Strava sheet.
 * Self-only: the state is a server-SIGNED, single-use link state for the JWT's athlete
 * (lib/strava/link-state.ts), reserved with return 'app', so the callback links the caller's
 * own row and then returns to `madregot://data-sources/strava`. A bare `app:<id>` state is
 * no longer accepted: anyone could have minted one for someone else's id.
 * Scope is read-only (`activity:read_all` + `read`, which Strava always grants).
 */
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  const athleteId = auth.user.athleteId;
  if (!athleteId) return NextResponse.json({ error: 'No athlete profile' }, { status: 403 });
  const state = signLinkState(athleteId);
  if (!state) return NextResponse.json({ error: 'Link signing unavailable' }, { status: 503 });
  if (!(await reserveLinkState(createServerClient(), state, athleteId, 'app'))) {
    return NextResponse.json({ error: 'Link unavailable, try again' }, { status: 503 });
  }
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: resolveStravaRedirectUri(request),
    response_type: 'code',
    scope: 'read,activity:read_all',
    approval_prompt: 'auto',
    state,
  });
  return NextResponse.json({
    authUrl: `https://www.strava.com/oauth/mobile/authorize?${p.toString()}`,
    callbackScheme: NATIVE_SCHEME,
  });
}
