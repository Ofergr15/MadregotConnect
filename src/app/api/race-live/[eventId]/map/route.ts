import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// PUT { on } — the caller opts in/out of seeing runners' live watch positions. Self only (JWT).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'member only' }, { status: 403 });
  const on = !!(await request.json().catch(() => ({}))).on;
  const db = createServerClient();
  const { error } = on
    ? await db.from('race_map_viewers').upsert({ event_id: eventId, athlete_id: caller.athleteId }, { onConflict: 'event_id,athlete_id' })
    : await db.from('race_map_viewers').delete().eq('event_id', eventId).eq('athlete_id', caller.athleteId);
  if (error) { console.error('[api/race-live/[eventId]/map]', error); return NextResponse.json({ error: 'save failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true, on });
}
