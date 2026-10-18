import { NextResponse } from 'next/server';
import { clubUpdatesCaller, forbidden } from '@/lib/club-updates/access';
import { loadRow, project } from '@/lib/club-updates/server';
import { isReaction } from '@/lib/club-updates/model';

export const dynamic = 'force-dynamic';

/** POST /api/club-updates/:id/react { emoji } — toggles the caller's emoji on the update. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  if (!c.access.canRead || !c.athleteId) return forbidden();
  const b = (await request.json().catch(() => null)) as { emoji?: unknown } | null;
  if (!isReaction(b?.emoji)) return NextResponse.json({ error: 'bad emoji' }, { status: 400 });
  const row = await loadRow(c.db, id);
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const key = { update_id: id, athlete_id: c.athleteId, emoji: b.emoji };
  const { data: had } = await c.db.from('club_update_reactions').select('emoji').match(key).maybeSingle();
  const { error } = had
    ? await c.db.from('club_update_reactions').delete().match(key)
    : await c.db.from('club_update_reactions').insert(key);
  if (error && error.code !== '23505') return NextResponse.json({ error: 'Failed' }, { status: 500 });
  const [update] = await project(c.db, [row], c.athleteId);
  return NextResponse.json({ update });
}
