import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';
import { resolveAppOrigin, stravaAuthEmail } from '@/lib/strava/client';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type TokenPayload = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: {
    id: number;
    firstname?: string;
    lastname?: string;
    profile?: string;
    profile_medium?: string;
  };
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function exchangeCode(code: string): Promise<TokenPayload> {
  const clientId = process.env.STRAVA_CLIENT_ID!;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET!;
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
    throw new Error(`token_failed:${await tokenRes.text()}`);
  }
  return tokenRes.json();
}

/**
 * Strava OAuth callback.
 * - state=login → upsert athlete, create Supabase session, → /auth/resolve
 * - state=<athleteId> → link tokens onto existing athlete (coach tooling)
 *
 * Activity import deliberately does not run here. It can take tens of seconds,
 * so the dashboard starts it after the browser session is established.
 */
export async function GET(request: Request) {
  const debugId = randomUUID().slice(0, 8);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  // Localhost stays local even if .env still points at production.
  // Behind a Cloudflare tunnel (non-localhost host), prefer NEXT_PUBLIC_APP_URL.
  const origin = resolveAppOrigin(request);
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : 'missing';

  console.info(`[auth-debug:${debugId}] callback:start`, {
    state,
    hasCode: !!code,
    origin,
    supabaseHost,
  });

  if (!code || !state) {
    console.error(`[auth-debug:${debugId}] callback:missing_params`);
    return NextResponse.redirect(new URL('/?strava=error&reason=missing_params', origin));
  }
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    console.error(`[auth-debug:${debugId}] callback:not_configured`);
    return NextResponse.redirect(new URL('/?strava=error&reason=not_configured', origin));
  }

  try {
    let tokenData: TokenPayload;
    try {
      tokenData = await exchangeCode(code);
    } catch (exchangeErr: any) {
      // If the code is already spent (duplicate callback hit), check whether the
      // first call already created a session for this user. Look up the most
      // recently created athlete whose Strava auth was updated in the last minute.
      const isInvalidCode =
        typeof exchangeErr?.message === 'string' && exchangeErr.message.includes('"invalid"');
      if (isInvalidCode && state === 'login') {
        const admin = adminClient();
        const cutoff = new Date(Date.now() - 60_000).toISOString();
        const { data: recent } = await admin
          .from('athletes')
          .select('id, email, name, strava_athlete_id')
          .eq('data_source', 'strava')
          .gte('updated_at', cutoff)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recent?.id) {
          console.info(`[auth-debug:${debugId}] callback:duplicate_code_recovered`, {
            athleteId: recent.id,
          });
          const authResult = await createSyntheticSession(admin, recent.email, {
            strava_athlete_id: recent.strava_athlete_id,
            athlete_id: recent.id,
            name: recent.name,
          });
          if (authResult.session) {
            const sessionFragment = new URLSearchParams({
              access_token: authResult.session.access_token,
              refresh_token: authResult.session.refresh_token,
              expires_in: String(authResult.session.expires_in),
              token_type: authResult.session.token_type,
              type: 'strava',
              debug_id: debugId,
            });
            return NextResponse.redirect(`${origin}/auth/resolve#${sessionFragment.toString()}`);
          }
        }
      }
      throw exchangeErr;
    }
    const stravaId = tokenData.athlete?.id;
    console.info(`[auth-debug:${debugId}] callback:code_exchanged`, {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      hasAthlete: !!stravaId,
    });
    if (!stravaId) {
      console.error(`[auth-debug:${debugId}] callback:no_athlete`);
      return NextResponse.redirect(new URL('/?strava=error&reason=no_athlete', origin));
    }

    const stravaAuth = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
      athlete_id: stravaId,
    };
    const encrypted = encrypt(stravaAuth);
    const name =
      [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(' ') ||
      `Strava ${stravaId}`;
    const email = stravaAuthEmail(stravaId);
    const avatar = tokenData.athlete?.profile || tokenData.athlete?.profile_medium || null;

    // ── Coach link mode ──────────────────────────────────────────────────────
    if (state !== 'login') {
      const supabase = createServerClient();
      const { error } = await supabase
        .from('athletes')
        .update({
          strava_auth: encrypted,
          strava_athlete_id: stravaId,
          strava_enabled: true,
          data_source: 'strava',
          ...(avatar ? { avatar_url: avatar } : {}),
        })
        .eq('id', state);
      if (error) {
        console.error('Failed to save Strava auth:', error);
        return NextResponse.redirect(
          new URL('/dashboard/athletes?strava=error&reason=save_failed', origin),
        );
      }
      return NextResponse.redirect(new URL('/dashboard/athletes?strava=connected', origin));
    }

    // ── Login mode ───────────────────────────────────────────────────────────
    const admin = adminClient();

    const { data: existing, error: existingError } = await admin
      .from('athletes')
      .select('id, approved, status, role')
      .eq('strava_athlete_id', stravaId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    console.info(`[auth-debug:${debugId}] callback:athlete_lookup`, {
      found: !!existing,
      athleteId: existing?.id || null,
      errorCode: existingError?.code || null,
      errorMessage: existingError?.message || null,
    });
    if (existingError) {
      console.error('Strava login athlete lookup failed:', existingError);
      return NextResponse.redirect(new URL('/?strava=error&reason=lookup_failed', origin));
    }

    let athleteId = existing?.id as string | undefined;

    if (athleteId) {
      await admin
        .from('athletes')
        .update({
          strava_auth: encrypted,
          strava_enabled: true,
          data_source: 'strava',
          name,
          email,
          ...(avatar ? { avatar_url: avatar } : {}),
        })
        .eq('id', athleteId);
    } else {
      // Ensure club coach row exists (athletes.coach_id FK) — create placeholder if missing.
      await admin.from('coaches').upsert(
        { id: COACH_ID, email: 'coach@madregot.local', name: 'Madregot Coach' },
        { onConflict: 'id' },
      );

      const { data: created, error: insertErr } = await admin
        .from('athletes')
        .insert({
          name,
          email,
          role: 'runner',
          status: 'active',
          coach_id: COACH_ID,
          approved: true, // Strava-first: auto-approve on login; tighten later if needed
          approved_at: new Date().toISOString(),
          strava_auth: encrypted,
          strava_athlete_id: stravaId,
          strava_enabled: true,
          data_source: 'strava',
          ...(avatar ? { avatar_url: avatar } : {}),
        })
        .select('id')
        .single();
      if (insertErr || !created) {
        console.error('Strava login athlete insert failed:', insertErr);
        return NextResponse.redirect(new URL('/?strava=error&reason=save_failed', origin));
      }
      athleteId = created.id;
    }

    const authResult = await createSyntheticSession(admin, email, {
      strava_athlete_id: stravaId,
      athlete_id: athleteId,
      name,
    });
    console.info(`[auth-debug:${debugId}] callback:session_created`, {
      hasSession: !!authResult.session,
      authUserId: authResult.user?.id || null,
      error: authResult.error || null,
    });
    if (authResult.error || !authResult.session) {
      return NextResponse.redirect(
        new URL(
          `/?strava=error&reason=session_create_failed&debug=${encodeURIComponent(debugId)}`,
          origin,
        ),
      );
    }

    const sessionFragment = new URLSearchParams({
      access_token: authResult.session.access_token,
      refresh_token: authResult.session.refresh_token,
      expires_in: String(authResult.session.expires_in),
      token_type: authResult.session.token_type,
      type: 'strava',
      debug_id: debugId,
    });
    console.info(`[auth-debug:${debugId}] callback:redirect_resolve`);
    return NextResponse.redirect(`${origin}/auth/resolve#${sessionFragment.toString()}`);
  } catch (err) {
    console.error(`[auth-debug:${debugId}] callback:exception`, err);
    return NextResponse.redirect(
      new URL(`/?strava=error&reason=unknown&debug=${debugId}`, origin),
    );
  }
}
