import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { feedHiddenIds } from '@/lib/runs/meetups';

export const dynamic = 'force-dynamic';

// POST /api/runs/meetups/hide { meetupId } — the ✕ on the feed's "רצים יחד" row: that run
// leaves this member's feed (the run-together page keeps it). Kept in
// notification_prefs.feedHiddenMeetups, merged so every other preference stays as it was —
// no migration. The host and people going can't hide their own run; the feed pins it.
export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const body = (await request.json().catch(() => ({}))) as { meetupId?: unknown };
  const meetupId = typeof body.meetupId === 'string' ? body.meetupId.trim() : '';
  if (!meetupId) return NextResponse.json({ error: 'meetupId is required' }, { status: 400 });
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('notification_prefs').eq('id', auth.user.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const prefs = ((data?.notification_prefs as Record<string, unknown> | null) || {});
  const ids = feedHiddenIds(prefs);
  if (!ids.includes(meetupId)) ids.push(meetupId);
  const { error: upErr } = await db.from('athletes').update({ notification_prefs: { ...prefs, feedHiddenMeetups: ids.slice(-200) } }).eq('id', auth.user.athleteId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
