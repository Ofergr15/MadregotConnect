import { NextResponse } from 'next/server';
import { clubUpdatesCaller, forbidden } from '@/lib/club-updates/access';
import { loadRow, project } from '@/lib/club-updates/server';
import { MAX_CHARS, RESTORE_MS, mayEdit, visibleLength } from '@/lib/club-updates/model';

export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/club-updates/:id { body?, imageUrl?, breaking?, pinned?, restore? } — its writer
 *        or the admin. An edit sends no push again; `restore` undoes a delete for RESTORE_MS.
 * DELETE /api/club-updates/:id — soft: off the stream and the feed. A push already sent stays
 *        on the phones that got it; one still in its undo window never goes.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  const row = await loadRow(c.db, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!mayEdit(c.access, c.athleteId, row.author_athlete_id)) return forbidden();
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const patch: Record<string, unknown> = {};
  if (b?.restore === true) {
    if (!row.deleted_at || Date.now() - Date.parse(row.deleted_at) > RESTORE_MS) return NextResponse.json({ error: 'Too late to restore' }, { status: 409 });
    patch.deleted_at = null;
  } else {
    if (row.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (typeof b?.body === 'string') {
      const body = b.body.trim();
      if (!body || visibleLength(body) > MAX_CHARS) return NextResponse.json({ error: `עד ${MAX_CHARS} תווים` }, { status: 400 });
      if (body !== row.body) { patch.body = body; patch.edited_at = new Date().toISOString(); }
    }
    if ('imageUrl' in (b || {})) {
      const url = typeof b?.imageUrl === 'string' && /^https:\/\//.test(b.imageUrl) ? b.imageUrl : null;
      if (url !== row.image_url) { patch.image_url = url; patch.edited_at = new Date().toISOString(); }
    }
    if (typeof b?.breaking === 'boolean') patch.breaking = b.breaking;
    if (typeof b?.pinned === 'boolean') patch.pinned = b.pinned;
  }
  if (Object.keys(patch).length === 0) {
    const [update] = await project(c.db, [row], c.athleteId);
    return NextResponse.json({ update });
  }
  const { data, error } = await c.db.from('club_updates').update(patch).eq('id', id).select('*').single();
  if (error) {
    console.error('[club-updates] update failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  const [update] = await project(c.db, [data as typeof row], c.athleteId);
  return NextResponse.json({ update });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  const row = await loadRow(c.db, id);
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!mayEdit(c.access, c.athleteId, row.author_athlete_id)) return forbidden();
  const { error } = await c.db.from('club_updates').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  // Was its push still waiting? Then it never goes (sendUpdatePush skips deleted rows).
  return NextResponse.json({ ok: true, pushStopped: !!row.notify_at && !row.notified_at });
}
