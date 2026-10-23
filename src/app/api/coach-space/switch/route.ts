import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { COACH_SPACE_KEY, isCoachSpaceOn, mayToggleCoachSpace } from '@/lib/coach-space/switch';

export const dynamic = 'force-dynamic';

// GET /api/coach-space/switch → { on, canToggle }   (the tab bar and the settings row read it)
// PUT /api/coach-space/switch { on }                admin / super user only — the coach space
//                                                   for every coach (lib/coach-space/switch.ts).
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const on = await isCoachSpaceOn(createServerClient());
  return NextResponse.json({ on, canToggle: mayToggleCoachSpace(auth.user) });
}

export async function PUT(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayToggleCoachSpace(auth.user)) return NextResponse.json({ error: 'admin only' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'on must be a boolean' }, { status: 400 });
  const db = createServerClient();
  const { error } = await db.from('app_settings').upsert({ key: COACH_SPACE_KEY, value: body.on ? 'on' : 'off' }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ on: body.on, canToggle: true });
}
