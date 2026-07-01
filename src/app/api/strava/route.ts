import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const athleteId = searchParams.get('athleteId');

  if (!athleteId) {
    return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/strava/callback`;

  if (!clientId) {
    return NextResponse.json({ error: 'Strava not configured' }, { status: 500 });
  }

  const scope = 'read,activity:read_all';
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${athleteId}`;

  return NextResponse.json({ authUrl });
}
