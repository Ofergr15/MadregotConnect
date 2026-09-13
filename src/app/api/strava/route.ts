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
  // Tracked as a flag rather than re-derived from `mode` below: the login branch is
  // also reached implicitly, by a caller that named no athlete at all, and the
  // approval-prompt decision underneath must cover that door too.
  let isLoginMode = false;
  if (inviteTokenParam && !inviteToken) {
    return NextResponse.json({ error: 'invalid inviteToken' }, { status: 400 });
  } else if (inviteToken) {
    state = joinState(inviteToken);
  } else if (mode === 'login' || (!athleteId && mode !== 'link')) {
    state = loginState(challenge);
    isLoginMode = true;
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
  // `switch=1` means "I am connected to the WRONG Strava account and want a
  // different one". With approval_prompt=auto Strava skips its own screen entirely
  // for an app it has already authorised, so the member is bounced straight back
  // into the same wrong account and the retry looks like it did nothing. `force`
  // is what makes Strava draw the page that says which athlete it is about to
  // connect — and offers to sign in as somebody else. Only ever set deliberately:
  // on a first connect the extra screen is friction for no reason.
  //
  // Login mode is ALSO always `force`, for a different reason: it is the only mode
  // where the app does not know who the caller is. Everything else names an athlete
  // (`athleteId`) or carries an invite token, so a silent reuse lands the tokens on
  // a row we already chose. Login mode instead *derives* identity from whatever
  // account Strava hands back — so `auto` means the browser's already-authorised
  // account decides who you are logged in as, with no screen naming it and no way
  // to catch it.
  //
  // That is not hypothetical. On 2026-09-13 a member reconnecting from a signed-out
  // landing page was bounced through `auto` into an empty Strava account (id
  // 659081577) that he had created moments earlier on Strava's own authorize page —
  // which offers signup to anyone not signed in. None of the callback's three
  // recognition paths could match it (no Strava id on his row, a synthetic email,
  // and a `Strava 659081577` placeholder name), so it fell through to the
  // stranger-insert and he was greeted by his own app as a brand-new pending member
  // being asked for his measurements. Nothing was lost, but nothing about it was
  // visible to him either.
  //
  // The cost is one extra tap on sign-in. Sign-in is rare — the session persists —
  // and the screen it adds is the only moment anyone can see which athlete they are
  // about to become.
  const approvalPrompt = searchParams.get('switch') === '1' || isLoginMode ? 'force' : 'auto';
  const authUrl =
    `https://www.strava.com/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&approval_prompt=${approvalPrompt}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.json({ authUrl });
}
