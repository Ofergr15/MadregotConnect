import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { tagsGate } from '@/lib/photos/tags-gate';
import { missingTable } from '@/lib/photos/tags';

export const dynamic = 'force-dynamic';

/** GET → { items: [{ mediaId, folderId, kind, likedAt }] } — what the caller liked, newest first ("אהבתי"). */
export async function GET(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  const { data, error } = await createServerClient().from('photo_likes').select('media_id, folder_id, kind, created_at')
    .eq('athlete_id', g.actor.athleteId).order('created_at', { ascending: false }).limit(1000);
  if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
  if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
  return NextResponse.json({ items: ((data || []) as Array<{ media_id: string; folder_id: string; kind: string; created_at: string }>)
    .map((r) => ({ mediaId: r.media_id, folderId: r.folder_id, kind: r.kind, likedAt: r.created_at })) });
}
