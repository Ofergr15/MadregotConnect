import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { israelNow, israelToday } from '@/lib/utils';
import { loadWeekStory } from '@/lib/week-story/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/week-story[?athleteId=&at=YYYY-MM-DD]
 *
 * The caller's "השבוע שלך" while it is open (Saturday 12:00 → Sunday 20:00, Israel), or
 * `{ story: null }` — outside the window, or a week without a run. The admin may read
 * anybody's, and any Saturday's (`at`), to check it before it goes out.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const admin = caller.isSuperUser || hasRole(caller, 'admin');
  const q = new URL(request.url).searchParams;
  const athleteId = (admin && q.get('athleteId')) || caller.athleteId;
  if (!athleteId) return NextResponse.json({ story: null });
  const at = admin ? q.get('at') : null;
  const today = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : israelToday();
  // A preview reads the week as of that Saturday's end.
  const hour = at ? 23 : israelNow().hour;
  try {
    const story = await loadWeekStory(createServerClient(), athleteId, today, hour, at ? new Date(`${today}T20:59:00Z`) : new Date());
    return NextResponse.json({ story });
  } catch (err) {
    console.error('week-story read failed:', err);
    return NextResponse.json({ error: 'Failed to read the week' }, { status: 500 });
  }
}

/**
 * PATCH /api/week-story  { hidePack: boolean }
 *
 * The pack slide is the member's choice (Ofer, 2026-10-19: "שלא חייב להשתמש בזה"): kept in
 * notification_prefs.weekStory, merged so the notification switches beside it stay as they are.
 */
export async function PATCH(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { hidePack?: unknown };
  if (typeof body.hidePack !== 'boolean') return NextResponse.json({ error: 'hidePack must be true or false' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('notification_prefs').eq('id', caller.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const prefs = ((data?.notification_prefs as Record<string, unknown> | null) || {});
  const weekStory = { ...((prefs.weekStory as Record<string, unknown>) || {}), hidePack: body.hidePack };
  const { error: upErr } = await db.from('athletes').update({ notification_prefs: { ...prefs, weekStory } }).eq('id', caller.athleteId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, hidePack: body.hidePack });
}
