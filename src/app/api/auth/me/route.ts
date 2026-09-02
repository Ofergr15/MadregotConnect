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
    if (!auth.user.athleteId) {
      return NextResponse.json({ role: auth.user.role || 'coach' });
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

    return NextResponse.json({ role: auth.user.role || 'runner', isAcademy: !!row?.is_academy });
  } catch (error) {
    console.error('Failed to resolve user role:', error);
    return NextResponse.json({ error: 'Failed to resolve role' }, { status: 500 });
  }
}
