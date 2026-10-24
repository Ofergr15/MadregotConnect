import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { israelNow, israelToday } from '@/lib/utils';
import { loadWeekStory } from '@/lib/week-story/server';
import { storyWindow } from '@/lib/week-story/model';
import { storyGate } from '@/lib/stories/gate';
import { addDays } from '@/lib/notifications/approval';
import { isTheme, withMemberChoice, type Theme, type WorkoutPick } from '@/lib/week-story/layout';

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
  let at = admin ? q.get('at') : null;
  // Testers see it any time (Ofer 10-24: "we said we'd open it to him so he can look"): outside
  // the Saturday 12:00 – Sunday 20:00 window, the week up to the latest Saturday, as it will read.
  if (!at && athleteId === caller.athleteId && !storyWindow(israelToday(), israelNow().hour)) {
    const gate = await storyGate('weekly', caller.athleteId, { isAdmin: admin }).catch(() => null);
    if (gate?.tester) {
      const t = israelToday(); const wd = new Date(`${t}T12:00:00Z`).getUTCDay();
      at = addDays(t, -((wd + 1) % 7));
    }
  }
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
 * PATCH /api/week-story  { hidePack: boolean } | { workout: 'quality'|'long', weekEnd } | { theme: preset | '#rrggbb' }
 *
 * The member's own story choices, kept in notification_prefs.weekStory and merged so the
 * notification switches beside them stay as they are: the pack slide (Ofer, 2026-10-19:
 * "שלא חייב להשתמש בזה"), which of the week's workouts the slide shows, and the background.
 */
export async function PATCH(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { hidePack?: unknown; workout?: unknown; weekEnd?: unknown; theme?: unknown };
  const change: { hidePack?: boolean; workout?: WorkoutPick; weekEnd?: string; theme?: Theme } = {};
  if ('hidePack' in body) {
    if (typeof body.hidePack !== 'boolean') return NextResponse.json({ error: 'hidePack must be true or false' }, { status: 400 });
    change.hidePack = body.hidePack;
  }
  if ('workout' in body) {
    if ((body.workout !== 'quality' && body.workout !== 'long') || typeof body.weekEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekEnd)) {
      return NextResponse.json({ error: 'workout must be quality|long with weekEnd' }, { status: 400 });
    }
    change.workout = body.workout; change.weekEnd = body.weekEnd;
  }
  if ('theme' in body) {
    if (!isTheme(body.theme)) return NextResponse.json({ error: 'theme must be a preset or #rrggbb' }, { status: 400 });
    change.theme = body.theme;
  }
  if (!Object.keys(change).length) return NextResponse.json({ error: 'nothing to change' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('notification_prefs').eq('id', caller.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const prefs = ((data?.notification_prefs as Record<string, unknown> | null) || {});
  const weekStory = withMemberChoice(prefs.weekStory, change);
  if (change.hidePack !== undefined) weekStory.hidePack = change.hidePack;
  const { error: upErr } = await db.from('athletes').update({ notification_prefs: { ...prefs, weekStory } }).eq('id', caller.athleteId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...change });
}
