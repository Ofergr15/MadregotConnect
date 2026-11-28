import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { actorOf, pending, requireAdmin } from '@/lib/access-groups/gate';
import {
  ACCESS_GROUPS_TABLE, ACCESS_GROUP_AUDIT_TABLE, ACCESS_GROUP_MEMBERS_TABLE, MAX_MEMBERS_PER_CALL, migrationPending,
} from '@/lib/access-groups/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function groupExists(db: ReturnType<typeof createServerClient>, id: string) {
  const { data, error } = await db.from(ACCESS_GROUPS_TABLE).select('id').eq('id', id).maybeSingle();
  return { exists: !!data, error };
}

// POST {athleteIds: string[]} → { added }   (ids that are not athletes are dropped, not invented)
export async function POST(request: Request, { params }: Ctx) {
  const { denied, caller } = await requireAdmin(request, { write: true });
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const raw: unknown[] = Array.isArray(body?.athleteIds) ? body.athleteIds : [];
    const wanted = [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))];
    if (!wanted.length) return NextResponse.json({ error: 'athleteIds required' }, { status: 400 });
    if (wanted.length > MAX_MEMBERS_PER_CALL) return NextResponse.json({ error: `at most ${MAX_MEMBERS_PER_CALL} per call` }, { status: 400 });
    const db = createServerClient();
    const g = await groupExists(db, id);
    if (g.error) return migrationPending(g.error) ? pending() : NextResponse.json({ error: 'Failed' }, { status: 500 });
    if (!g.exists) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { data: real } = await db.from('athletes').select('id').in('id', wanted);
    const ids = ((real || []) as Array<{ id: string }>).map((r) => String(r.id));
    if (!ids.length) return NextResponse.json({ error: 'no such athletes' }, { status: 404 });
    const actor = actorOf(caller);
    const { error } = await db.from(ACCESS_GROUP_MEMBERS_TABLE)
      .upsert(ids.map((a) => ({ group_id: id, athlete_id: a, added_by: actor })), { onConflict: 'group_id,athlete_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: 'Failed to add' }, { status: 500 });
    await db.from(ACCESS_GROUP_AUDIT_TABLE).insert({ group_id: id, action: 'member_add', detail: { athleteIds: ids }, actor });
    return NextResponse.json({ added: ids });
  } catch (error: any) {
    console.error('[access-groups] add members failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// DELETE ?athleteId= → { ok }
export async function DELETE(request: Request, { params }: Ctx) {
  const { denied, caller } = await requireAdmin(request, { write: true });
  if (denied) return denied;
  const { id } = await params;
  const athleteId = new URL(request.url).searchParams.get('athleteId');
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  try {
    const db = createServerClient();
    const { error } = await db.from(ACCESS_GROUP_MEMBERS_TABLE).delete().eq('group_id', id).eq('athlete_id', athleteId);
    if (error) return migrationPending(error) ? pending() : NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
    await db.from(ACCESS_GROUP_AUDIT_TABLE).insert({ group_id: id, action: 'member_remove', detail: { athleteId }, actor: actorOf(caller) });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[access-groups] remove member failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
