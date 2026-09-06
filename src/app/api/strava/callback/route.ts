import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/encryption';
import { COACH_ID } from '@/lib/constants';
import { resolveAppOrigin, stravaAuthEmail } from '@/lib/strava/client';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';
import {
  matchAthleteByName,
  pickAthleteRow,
  type IdentityRow,
} from '@/lib/auth/athlete-identity';
import { HANDOFF_TTL_MS, parseLoginState } from '@/lib/auth/login-handoff';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Everything pickAthleteRow ranks on. garmin_auth and strava_auth are read as
// presence only — they are OAuth credentials and must not leave this route.
const ATHLETE_MATCH_COLUMNS =
  'id, name, email, role, status, created_at, strava_athlete_id, strava_auth, garmin_auth';

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
  // 'login' | 'login:<challenge>' | 'join:<inviteToken>' | '<athleteId>'. The
  // challenge means the login began in a standalone PWA, which cannot see a
  // session established here — park it in login_handoffs and let the app collect
  // it instead.
  const { isLogin, challenge, joinToken } = parseLoginState(state);
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
      // A spent code means this callback fired twice and the FIRST one already
      // minted the session — so hand the browser to /auth/resolve with no
      // fragment and let it pick that session up. If there wasn't one, resolve
      // bounces to /?strava=error&reason=session_failed, which the landing page
      // explains.
      //
      // What this replaces tried to identify the user by "the strava athlete
      // updated in the last minute" — a query against athletes.updated_at, a
      // column that does not exist in production, so it errored (the error was
      // discarded) and the recovery never once ran. Which is just as well: it was
      // not scoped to this user, so two members logging in within the same minute
      // could have been handed each other's session.
      const isInvalidCode =
        typeof exchangeErr?.message === 'string' && exchangeErr.message.includes('"invalid"');
      if (isInvalidCode && isLogin) {
        console.info(`[auth-debug:${debugId}] callback:duplicate_code`);
        return NextResponse.redirect(`${origin}/auth/resolve`);
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

    // ── Invite mode: the Strava step of /join/{token} ─────────────────────────
    //
    // Separate from login mode on purpose. Login mode has to GUESS who came back,
    // and for a just-approved member it guesses wrong in the worst way: it matches
    // on strava_athlete_id (still NULL), then the synthetic Strava address (not
    // their real one), then an exact name match against the ACTIVE roster — while
    // their row is `invited` and still carries the placeholder name derived from
    // their email address. All three miss, so login mode INSERTS A SECOND ROW,
    // auto-approved, and the row holding their group assignment is orphaned. That
    // is where every production duplicate came from (see the login branch below).
    //
    // Here there is nothing to guess: the invite token names exactly one row.
    if (joinToken) {
      const admin = adminClient();
      const { data: invited, error: inviteErr } = await admin
        .from('athletes')
        .select('id, email, name, approved, status, garmin_auth')
        .eq('invite_token', joinToken)
        .maybeSingle();

      if (inviteErr) {
        console.error(`[auth-debug:${debugId}] callback:invite_lookup_failed`, inviteErr);
        return NextResponse.redirect(new URL('/?strava=error&reason=lookup_failed', origin));
      }
      if (!invited) {
        // A token that no longer resolves — revoked, or already superseded. Send
        // them back to the join page, which explains an invalid link properly.
        console.error(`[auth-debug:${debugId}] callback:invite_not_found`);
        return NextResponse.redirect(new URL(`/join/${joinToken}?strava=invalid`, origin));
      }

      const { error: linkErr } = await admin
        .from('athletes')
        .update({
          strava_auth: encrypted,
          strava_athlete_id: stravaId,
          strava_enabled: true,
          // Same rule as login mode: data_source decides which sync cron owns
          // this athlete, so it is only claimed when Strava is the sole source.
          // Someone who already had Garmin on file keeps being synced by Garmin —
          // and keeps receiving pushed workouts, which Strava cannot deliver.
          ...(invited.garmin_auth ? {} : { data_source: 'strava' }),
          ...(avatar ? { avatar_url: avatar } : {}),
          // The approver already said yes; this is the athlete finishing up. The
          // `approved !== false` guard mirrors /api/athletes/connect exactly: an
          // explicitly unapproved row must not let itself in through this door.
          ...(invited.approved !== false ? { status: 'active' } : {}),
          onboarding_status: 'strava_authed',
        })
        .eq('id', invited.id);
      if (linkErr) {
        console.error(`[auth-debug:${debugId}] callback:invite_link_failed`, linkErr);
        return NextResponse.redirect(new URL(`/join/${joinToken}?strava=error`, origin));
      }

      // Their REAL address, not the synthetic Strava one: resolve-role matches the
      // athlete row by email, and the whole point of this branch is that we know
      // which row it is. Minting on the synthetic address would create a second
      // identity pointing at nothing.
      const joinAuth = await createSyntheticSession(admin, invited.email, {
        strava_athlete_id: stravaId,
        athlete_id: invited.id,
        name: invited.name || name,
      });
      if (joinAuth.error || !joinAuth.session) {
        console.error(`[auth-debug:${debugId}] callback:invite_session_failed`, joinAuth.error);
        // The Strava link itself succeeded, so don't imply the whole thing failed.
        // They can sign in from the landing page and will now be matched on
        // strava_athlete_id, which this request just wrote.
        return NextResponse.redirect(new URL('/?strava=linked&reason=session_failed', origin));
      }

      const joinFragment = new URLSearchParams({
        access_token: joinAuth.session.access_token,
        refresh_token: joinAuth.session.refresh_token,
        expires_in: String(joinAuth.session.expires_in),
        token_type: joinAuth.session.token_type,
        type: 'strava',
        debug_id: debugId,
      });
      console.info(`[auth-debug:${debugId}] callback:invite_complete`, { athleteId: invited.id });
      // Straight to /auth/resolve, same as a login. It reads the role, stores the
      // athlete keys and lands them on /feed — where FirstRunTour picks them up,
      // since it fires for anyone with no `onboarding_tour_seen_at`. So finishing
      // the join hands them directly to the in-app guide with no extra wiring.
      return NextResponse.redirect(`${origin}/auth/resolve#${joinFragment.toString()}`);
    }

    // ── Coach link mode ──────────────────────────────────────────────────────
    if (!isLogin) {
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

    // Who in the club is this? Three ways in, in descending order of certainty:
    // the Strava athlete id, the synthetic address derived from it, and — only if
    // neither exists yet — an exact unique name match against the active roster.
    // The id-only lookup this replaces could not recognise a member on their
    // FIRST Strava login, because strava_athlete_id is written by a Strava login:
    // it was always NULL, so the callback inserted a second row for someone
    // already in the club. That is where all four production duplicates came from.
    const { data: matched, error: existingError } = await admin
      .from('athletes')
      .select(ATHLETE_MATCH_COLUMNS)
      .or(`strava_athlete_id.eq.${stravaId},email.eq.${email}`);
    if (existingError) {
      console.error('Strava login athlete lookup failed:', existingError);
      return NextResponse.redirect(new URL('/?strava=error&reason=lookup_failed', origin));
    }

    let existing = pickAthleteRow((matched || []) as unknown as IdentityRow[], stravaId);
    let matchedBy = existing ? 'strava_identity' : 'none';

    if (!existing) {
      // First Strava login for a member who is already on the roster. Small club,
      // so read the active rows and match in JS: the comparison normalises case,
      // whitespace and Unicode composition, none of which PostgREST can do.
      const { data: roster } = await admin
        .from('athletes')
        .select(ATHLETE_MATCH_COLUMNS)
        .eq('status', 'active');
      existing = matchAthleteByName((roster || []) as unknown as IdentityRow[], name);
      if (existing) matchedBy = 'name';
    }

    console.info(`[auth-debug:${debugId}] callback:athlete_lookup`, {
      found: !!existing,
      athleteId: existing?.id || null,
      matchedBy,
      candidates: matched?.length || 0,
    });

    let athleteId = existing?.id as string | undefined;

    if (athleteId) {
      // Adopt the existing row. Two fields are deliberately NOT written:
      //
      //   email — overwriting a member's own address with the synthetic one broke
      //     this outright. athletes.email is UNIQUE in production, the duplicate
      //     row already held the synthetic address, so the UPDATE failed on the
      //     constraint; its error was discarded, the row silently kept its real
      //     address, and resolve-role then matched the synthetic address to the
      //     duplicate. Logging in should never rename an account anyway.
      //   data_source — it decides which sync cron owns this athlete, so flipping
      //     it on every login cut a Garmin athlete off from Garmin sync. Only
      //     claim it when Strava really is the only source connected.
      const { error: updateErr } = await admin
        .from('athletes')
        .update({
          strava_auth: encrypted,
          strava_athlete_id: stravaId,
          strava_enabled: true,
          ...(existing?.garmin_auth ? {} : { data_source: 'strava' }),
          ...(avatar ? { avatar_url: avatar } : {}),
        })
        .eq('id', athleteId);
      if (updateErr) {
        // Never silent again: this is the failure that let a broken login look
        // like a successful one all the way through to the feed.
        console.error(`[auth-debug:${debugId}] callback:adopt_failed`, updateErr);
        return NextResponse.redirect(new URL('/?strava=error&reason=save_failed', origin));
      }
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

    // ── Handoff mode ─────────────────────────────────────────────────────────
    // The login started in a standalone PWA, so we are running inside iOS's
    // in-app browser sheet and anything we establish here lands in the sheet's
    // storage partition, which the app cannot read. Park the login instead: the
    // app claims it with the verifier it kept, and mints the session in its OWN
    // partition. No session is created here at all — one login, one session, so
    // there is no second refresh token to rotate this one out from under the app.
    if (challenge) {
      // Self-cleaning, so no cron has to remember this table exists.
      await admin.from('login_handoffs').delete().lt('expires_at', new Date().toISOString());
      const { error: handoffErr } = await admin.from('login_handoffs').insert({
        challenge,
        auth_email: email,
        expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
      });
      if (!handoffErr) {
        console.info(`[auth-debug:${debugId}] callback:handoff_parked`);
        return NextResponse.redirect(`${origin}/auth/handoff?debug=${debugId}`);
      }
      // Migration 082 not applied yet, or the insert genuinely failed. Fall
      // through to establishing the session right here — which is the behaviour
      // this branch improves on, not a broken state.
      console.error(`[auth-debug:${debugId}] callback:handoff_failed`, handoffErr);
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
