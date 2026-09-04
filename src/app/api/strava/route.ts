import { NextResponse } from 'next/server';
import { resolveStravaRedirectUri } from '@/lib/strava/client';
import { loginState } from '@/lib/auth/login-handoff';

/**
 * GET /api/strava?mode=login[&challenge=<base64url sha256>]
 * GET /api/strava?athleteId=<uuid>  (coach link to existing athlete)
 *
 * Returns { authUrl } for the Strava OAuth authorize page.
 *
 * `challenge` is how a standalone PWA asks for its session back rather than
 * having it established wherever the OAuth ends up — see lib/auth/login-handoff.
 * Omitting it keeps the old behaviour, which is the right one in a browser tab.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');
  const athleteId = searchParams.get('athleteId');
  // Echoed straight back to us by Strava and then used as a primary key, so it
  // is shape-checked here rather than trusted: 43 chars of base64url, the length
  // of a SHA-256 digest. Anything else is dropped and the login proceeds without
  // a handoff instead of failing.
  const challengeParam = searchParams.get('challenge');
  const challenge =
    challengeParam && /^[A-Za-z0-9_-]{43}$/.test(challengeParam) ? challengeParam : null;

  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = resolveStravaRedirectUri(request);

  if (!clientId) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  let state: string;
  if (mode === 'login' || (!athleteId && mode !== 'link')) {
    state = loginState(challenge);
  } else if (athleteId) {
    state = athleteId;
  } else {
    return NextResponse.json({ error: 'athleteId or mode=login required' }, { status: 400 });
  }

  const scope = 'read,activity:read_all,profile:read_all';
  const authUrl =
    `https://www.strava.com/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&approval_prompt=auto` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.json({ authUrl });
}
