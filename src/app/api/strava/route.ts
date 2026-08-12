import { NextResponse } from 'next/server';

/**
 * GET /api/strava?mode=login
 * GET /api/strava?athleteId=<uuid>  (coach link to existing athlete)
 *
 * Returns { authUrl } for the Strava OAuth authorize page.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');
  const athleteId = searchParams.get('athleteId');

  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri =
    process.env.STRAVA_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/strava/callback`;

  if (!clientId) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  let state: string;
  if (mode === 'login' || (!athleteId && mode !== 'link')) {
    state = 'login';
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
