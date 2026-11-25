import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { tagsGate } from '@/lib/photos/tags-gate';
import { isDriveId, missingTable } from '@/lib/photos/tags';

export const dynamic = 'force-dynamic';

/** POST { photoId } → { ok } — the tagged person approves a pending tag of THEMSELVES. Nobody else can. */
export async function POST(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isDriveId(b?.photoId)) return NextResponse.json({ error: 'photoId required' }, { status: 400 });
  try {
    const { data, error } = await createServerClient().from('photo_tags')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('photo_id', b!.photoId as string).eq('athlete_id', g.actor.athleteId).eq('status', 'pending').select('id');
    if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
    if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/photos/tags/approve]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
