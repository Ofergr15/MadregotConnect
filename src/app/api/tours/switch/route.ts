import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { COACH_TOUR_KEY, isCoachTourOn, mayToggleCoachTour } from '@/lib/tour/switch';

export const dynamic = 'force-dynamic';

// GET /api/tours/switch → { on, canToggle }   (the settings row reads it)
// PUT /api/tours/switch { on }                 admin / super user only — the coach tour and
//                                              its blue dots for every coach (lib/tour/switch.ts).
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const on = await isCoachTourOn(createServerClient());
  return NextResponse.json({ on, canToggle: mayToggleCoachTour(auth.user) });
}

export async function PUT(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayToggleCoachTour(auth.user)) return NextResponse.json({ error: 'admin only' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'on must be a boolean' }, { status: 400 });
  const db = createServerClient();
  const { error } = await db.from('app_settings').upsert({ key: COACH_TOUR_KEY, value: body.on ? 'on' : 'off' }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ on: body.on, canToggle: true });
}
