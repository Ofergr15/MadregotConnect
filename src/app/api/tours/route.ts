import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAthlete, authError } from '@/lib/auth-session';
import { applyTourChange, readTourPrefs } from '@/lib/tour/prefs';

export const dynamic = 'force-dynamic';

// GET  /api/tours → { tours, hotspots }: which guided tours this person has been through,
//      and which "new here" dots they dismissed (lib/tour/prefs.ts).
// POST /api/tours { tour, state } | { hotspot } | { reset } — merged into
//      athletes.notification_prefs, every other preference kept. No migration.
export async function GET(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('notification_prefs').eq('id', auth.user.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(readTourPrefs(data?.notification_prefs));
}

export async function POST(request: Request) {
  const auth = await requireAthlete(request);
  if (!auth.ok) return authError(auth);
  const body = (await request.json().catch(() => ({}))) as { tour?: unknown; state?: unknown; hotspot?: unknown; reset?: unknown };
  const change = {
    tour: typeof body.tour === 'string' ? body.tour : undefined,
    state: typeof body.state === 'string' ? body.state : undefined,
    hotspot: typeof body.hotspot === 'string' ? body.hotspot : undefined,
    reset: typeof body.reset === 'string' ? body.reset : undefined,
  };
  const db = createServerClient();
  const { data, error } = await db.from('athletes').select('notification_prefs').eq('id', auth.user.athleteId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const next = applyTourChange(data?.notification_prefs, change);
  if (!next) return NextResponse.json({ error: 'bad change' }, { status: 400 });
  const { error: upErr } = await db.from('athletes').update({ notification_prefs: next }).eq('id', auth.user.athleteId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json(readTourPrefs(next));
}
