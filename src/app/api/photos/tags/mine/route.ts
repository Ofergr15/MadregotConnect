import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { tagsGate } from '@/lib/photos/tags-gate';
import { missingTable, namesFor, project, type PhotoTagRow } from '@/lib/photos/tags';

export const dynamic = 'force-dynamic';

/** GET → { approved: PublicTag[], pending: PublicTag[] } — the caller's own tags, newest first ("התמונות שלי"). */
export async function GET(request: Request) {
  const g = await tagsGate(request);
  if (g.denied) return g.denied;
  try {
    const db = createServerClient();
    const { data, error } = await db.from('photo_tags').select('*').eq('athlete_id', g.actor.athleteId)
      .order('created_at', { ascending: false }).limit(1000);
    if (missingTable(error)) return NextResponse.json({ error: 'not ready' }, { status: 503 });
    if (error) return NextResponse.json({ error: 'failed', details: error.message }, { status: 500 });
    const tags = project(g.actor, (data || []) as PhotoTagRow[], await namesFor(db, [g.actor.athleteId]));
    return NextResponse.json({ approved: tags.filter((t) => t.status === 'approved'), pending: tags.filter((t) => t.status === 'pending') });
  } catch (err) {
    console.error('[api/photos/tags/mine]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
