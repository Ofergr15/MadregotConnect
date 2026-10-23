import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireContentLevel } from '@/lib/access/require-content';
import { approveSessionPhotos, type PhotosNotify } from '@/lib/quality-session/photos-server';

export const dynamic = 'force-dynamic';

// POST { date, notify: push|inapp|quiet, audience: all|attendees, circle } -> { id, photos, told }
//   The staff card's "לפרסם" (lib/quality-session/photos-server.ts approveSessionPhotos).
export async function POST(request: Request) {
  // Staff, or whoever publishes the photos part of Content (lib/access/grants.ts).
  const g = await requireContentLevel(request, 'photos', 3, (u) => u.isSuperUser || u.isStaff || !!u.canApprove);
  if (g.denied) return g.denied;
  const email = g.user.email ?? null;
  const auth = { ok: true as const, user: g.user };
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const date = typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });
  const notify: PhotosNotify = b?.notify === 'inapp' || b?.notify === 'quiet' ? b.notify : 'push';
  try {
    const out = await approveSessionPhotos(createServerClient(), {
      date, notify, audience: b?.audience === 'attendees' ? 'attendees' : 'all', circle: b?.circle === true,
      byAthleteId: auth.ok ? auth.user.athleteId ?? null : null, byEmail: email ?? null,
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error('[session-photos/approve] failed:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
