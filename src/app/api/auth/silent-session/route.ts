import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';
import { createSyntheticSession } from '@/lib/auth/synthetic-session';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// POST /api/auth/silent-session — mints a fresh Supabase session for an
// already-known athlete/coach email, without a real re-login.
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
export async function POST(request: Request) {
  try {
    const { email } = await request.json().catch(() => ({}));
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();

    // Only for an email that's already a real athlete/coach in this club —
    // never mint a session for an arbitrary address.
    const supabase = createServerClient();
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id')
      .ilike('email', normalized)
      .maybeSingle();
    if (!athlete) {
      return NextResponse.json({ error: 'unknown_email' }, { status: 404 });
    }

    const result = await createSyntheticSession(adminClient(), normalized);
    if (result.error || !result.session) {
      console.error('silent-session failed:', result.error);
      return NextResponse.json({ error: result.error || 'session_create_failed' }, { status: 500 });
    }
    return NextResponse.json({ session: result.session });
  } catch (err) {
    console.error('silent-session failed:', err);
    return NextResponse.json({ error: 'silent_session_failed' }, { status: 500 });
  }
}
