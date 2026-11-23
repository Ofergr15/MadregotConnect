import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// PUT /api/coach/lists/[id] { athleteId, member: boolean } — add / remove one runner.
// DELETE /api/coach/lists/[id] — remove the list (its memberships cascade).
// Staff-only. A list is a coach's grouping, not data about the runner, so removing
// one deletes nothing else.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : '';
  if (!athleteId || typeof body?.member !== 'boolean') {
    return NextResponse.json({ error: 'athleteId and member are required' }, { status: 400 });
  }
  const db = createServerClient();
  const res = body.member
    ? await db.from('athlete_list_members').upsert({ list_id: id, athlete_id: athleteId }, { onConflict: 'list_id,athlete_id' })
    : await db.from('athlete_list_members').delete().eq('list_id', id).eq('athlete_id', athleteId);
  if (res.error) { console.error('[api/coach/lists/[id]]', res.error); return NextResponse.json({ error: 'Failed to update list' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const { id } = await params;
  const db = createServerClient();
  const { error } = await db.from('athlete_lists').delete().eq('id', id);
  if (error) { console.error('[api/coach/lists/[id]]', error); return NextResponse.json({ error: 'Failed to delete list' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
