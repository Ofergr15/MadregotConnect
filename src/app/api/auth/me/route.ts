import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/auth/me — "what may the person holding this session see?"
//
// This is the nav's bootstrap call on every page load, and it used to answer it
// for whatever address arrived in x-user-email: sending a coach's email got you
// `role: 'admin'` and the full staff nav, and it doubled as an oracle for which
// addresses are members. requireSession does the same athletes-then-coaches
// lookup, from the JWT instead.
export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      // A verified account with no membership row is an answer, not a failure —
      // it's the 'viewer' this route already fell through to. Only a missing or
      // invalid token is a real 401.
      if (auth.status === 403) return NextResponse.json({ role: 'viewer' });
      return authError(auth);
    }

    // Staff that live only in `coaches` (legacy) have no athletes row to read
    // is_academy from, and nothing to stamp last_seen_at on.
    // `isSuper` rides along because the nav's view-as control was deciding it
    // client-side off whatever address localStorage happened to hold — a
    // synthetic Strava address answers "not the super user" and the control
    // disappears.
    //
    // Deriving it from the verified JWT email fixed the *forgeable* half but not
    // the synthetic-address half: the address is genuinely not SUPER_USER_EMAIL,
    // so the honest answer was still "no". Migration 084 moves the truth onto the
    // athlete row, and requireSession resolves row-flag-OR-literal; both flags
    // now just ride out from there. `canApprove` joins it so the Settings and
    // Registrations screens can stop importing the allowlist into the browser.
    // `=== true` rather than a bare read: JSON.stringify drops an undefined
    // value entirely, so a caller that resolved a session without these fields
    // would silently omit the keys instead of answering false.
    const isSuper = auth.user.isSuperUser === true;
    const canApproveHere = auth.user.canApprove === true;
    // הגרעין rides out the same way, and for the same reason `is_academy` does
    // below: it is a FLAG, not a role, so the client cannot derive the 🌰 badge
    // from `role` alone (migration 091). Free here — requireSession resolved it.
    const isCore = auth.user.isCoreRunner === true;

    if (!auth.user.athleteId) {
      return NextResponse.json({ role: auth.user.role || 'coach', isSuper, canApprove: canApproveHere, isCoreRunner: isCore });
    }

    const supabase = createServerClient();

    // `is_academy` rides along because academy membership is a flag, not a role:
    // an athlete with role `runner` can be in the academy (and several are), so
    // the nav can't derive their academy entry point from `role` alone. It's a
    // second read because requireSession's select can't carry it — that select
    // gates the whole app, and a column it doesn't have yet in some environment
    // must not be able to fail it. Here a missing column just reads as false.
    const { data: row } = await supabase
      .from('athletes')
      .select('is_academy')
      .eq('id', auth.user.athleteId)
      .maybeSingle();

    await supabase
      .from('athletes')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', auth.user.athleteId);

    return NextResponse.json({ role: auth.user.role || 'runner', isAcademy: !!row?.is_academy, isSuper, canApprove: canApproveHere, isCoreRunner: isCore });
  } catch (error) {
    console.error('Failed to resolve user role:', error);
    return NextResponse.json({ error: 'Failed to resolve role' }, { status: 500 });
  }
}
