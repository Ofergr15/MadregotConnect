import { NextResponse } from 'next/server';
import { resolveStravaRedirectUri } from '@/lib/strava/client';
import { loginState, joinState } from '@/lib/auth/login-handoff';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

/**
 * GET /api/strava?mode=login[&challenge=<base64url sha256>]
 * GET /api/strava?athleteId=<uuid>       (link Strava onto an existing athlete)
 * GET /api/strava?inviteToken=<32 hex>   (the Strava step of /join/{token})
 *
 * Returns { authUrl } for the Strava OAuth authorize page.
 *
 * The `inviteToken` branch is open, like `mode=login`, and for the same kind of
 * reason: the caller is a person who has been mailed a link and has no session
 * yet. It names nobody — the token IS the identity, it is unguessable, and the
 * callback resolves the athlete from it server-side. See `joinState` for why the
 * token and not an athlete id goes into `state`.
 *
 * `mode=login` is deliberately open — it is the sign-in entry point on the
 * public landing page, so there is no session to require yet, and the state it
 * mints names nobody.
 *
 * The `athleteId` branch is NOT open, because `state` is echoed back by Strava
 * and the callback's link mode writes the returning tokens onto whatever athlete
 * row `state` names. Ungated, that was a full account takeover in three steps:
 * ask this route for an authorize URL carrying a victim's athlete id, authorise
 * with your OWN Strava account, and the callback stamps your strava_athlete_id
 * onto their row — after which `mode=login` resolves you INTO their account,
 * because it matches on strava_athlete_id first. No password needed and no
 * session needed at any point; a bare athlete UUID was the whole credential.
 * (The retired /api/auth/athlete-login handed those UUIDs out for any email.)
 *
 * `challenge` is how a standalone PWA asks for its session back rather than
 * having it established wherever the OAuth ends up — see lib/auth/login-handoff.
 * Omitting it keeps the old behaviour, which is the right one in a browser tab.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');
  const athleteId = searchParams.get('athleteId');
  // Shape-checked here as well as in parseLoginState, so a malformed token is a
  // 400 the join page can show rather than a round trip to Strava that comes
  // back as an unexplained failure.
  const inviteTokenParam = searchParams.get('inviteToken');
  const inviteToken =
    inviteTokenParam && /^[0-9a-f]{32}$/.test(inviteTokenParam) ? inviteTokenParam : null;
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
  if (inviteTokenParam && !inviteToken) {
    return NextResponse.json({ error: 'invalid inviteToken' }, { status: 400 });
  } else if (inviteToken) {
    state = joinState(inviteToken);
  } else if (mode === 'login' || (!athleteId && mode !== 'link')) {
    state = loginState(challenge);
  } else if (athleteId) {
    // Self-or-staff: a runner may connect their own Strava (profile page), a
    // coach may connect anyone's (athletes page). Both are real callers, which
    // is why this is `requireCallerForAthlete` and not a staff-only gate.
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
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
