import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';
import {
  pickAthleteRow,
  stravaIdFromAuthEmail,
  type IdentityRow,
} from '@/lib/auth/athlete-identity';
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_OPTIONS,
  readDeviceToken,
  signDeviceToken,
} from '@/lib/auth/device-token';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// POST /api/auth/silent-session — mints a fresh Supabase session for a browser
// that already completed a real login but has since lost its session.
//
// The feed's Supabase-JWT requirement (see feed-client.ts's authHeaders) was
// designed around the assumption every account keeps a live session — but
// createSyntheticSession only ever runs once, at the Strava OAuth callback.
// Everything else in the app runs on the localStorage athlete_id/coach_email
// identity, which never expires — so an athlete who doesn't touch the social
// feed for a while quietly loses their ONLY Supabase session with no path
// back except reconnecting Strava. This route gives feed-client.ts a way to
// silently re-mint one, the same self-heal philosophy already used for the
// app-icon badge count (see dashboard/layout.tsx) applied to auth instead.
//
// The identity comes from the signed httpOnly device cookie, NEVER from the
// request body. This route used to take an email and return real access and
// refresh tokens for it after only checking the address existed in `athletes`,
// which made knowing any member's email sufficient to take over their account —
// and, since staff are athletes rows too, to clear every requireSession gate in
// the app. It also answered "unknown_email" for addresses it didn't recognise,
// confirming membership to anyone who asked.
export async function POST(request: NextRequest) {
  try {
    const email = readDeviceToken(request.cookies.get(DEVICE_COOKIE)?.value);
    if (!email) {
      // No proof this browser ever logged in. The caller falls back to a real
      // login; deliberately says nothing about whether any address is a member.
      return NextResponse.json({ error: 'no_device_token' }, { status: 401 });
    }

    // The cookie is long-lived, so re-check the account still exists and is not
    // deactivated — a token issued a year ago must not outlive the membership.
    //
    // Resolved exactly the way a real login resolves (see athlete-identity), for
    // two reasons: a cookie holding a synthetic strava_<id>@… address has to reach
    // the member's real row rather than whichever row owns that address, and this
    // read used .maybeSingle(), which ERRORS when two rows share an email — so a
    // duplicated athlete was told their device had never logged in, and had their
    // device cookie deleted for good measure.
    const stravaId = stravaIdFromAuthEmail(email);
    const supabase = createServerClient();
    const query = supabase
      .from('athletes')
      .select('id, name, email, role, status, created_at, strava_athlete_id, strava_auth, garmin_auth');
    const { data: rows } = await (stravaId
      ? query.or(`email.ilike.${email},strava_athlete_id.eq.${stravaId}`)
      : query.ilike('email', email));
    const athlete = pickAthleteRow((rows || []) as unknown as IdentityRow[], stravaId);
    if (!athlete) {
      const gone = NextResponse.json({ error: 'no_device_token' }, { status: 401 });
      gone.cookies.delete(DEVICE_COOKIE);
      return gone;
    }

    // Refresh the session's metadata every time. createSyntheticSession merges it
    // onto the auth user, so a stale athlete_id written by an older login would
    // otherwise be carried forward for as long as the account exists.
    const result = await createSyntheticSession(adminClient(), email, {
      athlete_id: athlete.id,
      ...(athlete.strava_athlete_id ? { strava_athlete_id: athlete.strava_athlete_id } : {}),
      ...(athlete.name ? { name: athlete.name } : {}),
    });
    if (result.error || !result.session) {
      console.error('silent-session failed:', result.error);
      return NextResponse.json({ error: result.error || 'session_create_failed' }, { status: 500 });
    }

    const response = NextResponse.json({ session: result.session });
    // Slide the expiry so an actively-used browser never has to log in again.
    const refreshed = signDeviceToken(email);
    if (refreshed) response.cookies.set(DEVICE_COOKIE, refreshed, DEVICE_COOKIE_OPTIONS);
    return response;
  } catch (err) {
    console.error('silent-session failed:', err);
    return NextResponse.json({ error: 'silent_session_failed' }, { status: 500 });
  }
}
