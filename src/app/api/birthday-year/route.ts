import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { israelToday } from '@/lib/utils';
import { loadStory, sendingOn } from '@/lib/birthday-year/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/birthday-year[?athleteId=]
 *
 * A birthday story, from the birthday for a week, once the admin has switched sending on:
 * the caller's own (the feed's entry card), or any member's (the club birthday post's
 * "צפו בשנה של…" — Ofer, 2026-10-18: everyone sees it). `{ story: null }` otherwise. The
 * admin may read anybody's at any time, the next birthday included, to prepare it.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const admin = caller.isSuperUser || hasRole(caller, 'admin');
  const asked = new URL(request.url).searchParams.get('athleteId');
  const athleteId = asked || caller.athleteId;
  if (!athleteId) return NextResponse.json({ story: null });
  const preview = admin && !!asked;
  try {
    if (!preview && !(await sendingOn(supabase))) return NextResponse.json({ story: null });
    const story = await loadStory(supabase, athleteId, israelToday(), { preview });
    return NextResponse.json({ story });
  } catch (err) {
    console.error('birthday-year read failed:', err);
    return NextResponse.json({ error: 'Failed to read the year' }, { status: 500 });
  }
}
