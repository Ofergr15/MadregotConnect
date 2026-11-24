import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireContentLevel } from '@/lib/access/require-content';
import { approveSessionPhotos, type PhotosNotify } from '@/lib/quality-session/photos-server';

export const dynamic = 'force-dynamic';

// POST { date, notify: push|inapp|quiet, audience: all|attendees, circle, fileIds? } -> { id, photos, told }
//   fileIds (b23): staff's pick of Drive files in that day's folder — the card becomes exactly those.
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
  let fileIds: string[] | undefined;
  if (b?.fileIds !== undefined) {
    if (!Array.isArray(b.fileIds) || !b.fileIds.length || b.fileIds.length > 500
      || !b.fileIds.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(x))) {
      return NextResponse.json({ error: 'fileIds must be a non-empty list of Drive ids' }, { status: 400 });
    }
    fileIds = b.fileIds as string[];
  }
  const notify: PhotosNotify = b?.notify === 'inapp' || b?.notify === 'quiet' ? b.notify : 'push';
  try {
    const out = await approveSessionPhotos(createServerClient(), {
      date, notify, audience: b?.audience === 'attendees' ? 'attendees' : 'all', circle: b?.circle === true,
      byAthleteId: auth.ok ? auth.user.athleteId ?? null : null, byEmail: email ?? null, fileIds,
    });
    return NextResponse.json(out);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'no selected photos in folder' || msg === 'selection needs a Drive folder') return NextResponse.json({ error: msg }, { status: 400 });
    console.error('[session-photos/approve] failed:', err);
    return NextResponse.json({ error: (err as Error).message || 'Failed' }, { status: 500 });
  }
}
