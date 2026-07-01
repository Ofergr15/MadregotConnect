import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const athleteId = searchParams.get('state');

  if (!code || !athleteId) {
    return NextResponse.redirect(new URL('/dashboard/athletes?strava=error&reason=missing_params', request.url));
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/dashboard/athletes?strava=error&reason=not_configured', request.url));
  }

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Strava token exchange failed:', err);
      return NextResponse.redirect(new URL('/dashboard/athletes?strava=error&reason=token_failed', request.url));
    }

    const tokenData = await tokenRes.json();

    const stravaAuth = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
      athlete_id: tokenData.athlete?.id,
    };

    const encrypted = encrypt(stravaAuth);
    const supabase = createServerClient();

    const { error } = await supabase
      .from('athletes')
      .update({
        strava_auth: encrypted,
        strava_athlete_id: tokenData.athlete?.id,
        data_source: 'strava',
      })
      .eq('id', athleteId);

    if (error) {
      console.error('Failed to save Strava auth:', error);
      return NextResponse.redirect(new URL('/dashboard/athletes?strava=error&reason=save_failed', request.url));
    }

    return NextResponse.redirect(new URL('/dashboard/athletes?strava=connected', request.url));
  } catch (err: any) {
    console.error('Strava callback error:', err);
    return NextResponse.redirect(new URL('/dashboard/athletes?strava=error&reason=unknown', request.url));
  }
}
