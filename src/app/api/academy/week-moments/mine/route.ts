import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { planWeekStartOf } from '@/lib/utils';
import { traineeWeek, MomentsNotMigrated } from '@/lib/academy/week-moments-server';

export const dynamic = 'force-dynamic';

/** GET ?weekStart → the moments SENT to the caller this plan week, with their own personal line only.
 *  SELF ONLY: identity from the JWT; there is no athleteId parameter. */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ moments: [] });
  try {
    const weekStart = planWeekStartOf(new URL(request.url).searchParams.get('weekStart'));
    return NextResponse.json({ weekStart, moments: await traineeWeek(createServerClient(), caller.athleteId, weekStart) });
  } catch (e) {
    if (e instanceof MomentsNotMigrated) return NextResponse.json({ weekStart: null, moments: [], code: e.code });
    console.error('GET /api/academy/week-moments/mine', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
