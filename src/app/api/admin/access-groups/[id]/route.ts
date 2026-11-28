import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { actorOf, pending, requireAdmin } from '@/lib/access-groups/gate';
import {
  ACCESS_GROUPS_TABLE, ACCESS_GROUP_AUDIT_TABLE, ACCESS_GROUP_MEMBERS_TABLE, cleanColor, cleanGroupName, migrationPending,
} from '@/lib/access-groups/store';
import { ENABLEMENTS_TABLE } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// GET    → { group, members: [{id,name,avatarUrl,role}], screens }
// PATCH  {name?, color?} → { group }
// DELETE → { ok } — also clears the group's feature_enablements rows.
export async function GET(request: Request, { params }: Ctx) {
  const { denied } = await requireAdmin(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const db = createServerClient();
    const { data: g, error } = await db.from(ACCESS_GROUPS_TABLE).select('id, name, color').eq('id', id).maybeSingle();
    if (error) return migrationPending(error) ? pending() : NextResponse.json({ error: 'Failed' }, { status: 500 });
    if (!g) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const [{ data: mem }, { data: rows }] = await Promise.all([
      db.from(ACCESS_GROUP_MEMBERS_TABLE).select('athlete_id').eq('group_id', id),
      db.from(ENABLEMENTS_TABLE).select('feature, enabled').eq('scope_type', 'access_group').eq('scope_id', id),
    ]);
    const ids = ((mem || []) as Array<{ athlete_id: string }>).map((m) => String(m.athlete_id));
    const { data: people } = ids.length
      ? await db.from('athletes').select('id, name, avatar_url, role').in('id', ids)
      : { data: [] };
    const members = ((people || []) as Array<{ id: string; name: string | null; avatar_url: string | null; role: string | null }>)
      .map((p) => ({ id: String(p.id), name: p.name, avatarUrl: p.avatar_url, role: p.role }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
    const screens: Record<string, boolean> = {};
    for (const r of (rows || []) as Array<{ feature: string; enabled: boolean }>) screens[r.feature] = !!r.enabled;
    return NextResponse.json({ group: { id: String(g.id), name: g.name, color: g.color, memberCount: members.length }, members, screens });
  } catch (error: any) {
    console.error('[access-groups] GET one failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { denied, caller } = await requireAdmin(request, { write: true });
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, string> = {};
    if (body?.name !== undefined) {
      const n = cleanGroupName(body.name);
      if (!n) return NextResponse.json({ error: 'name must be 1–60 characters' }, { status: 400 });
      patch.name = n;
    }
    if (body?.color !== undefined) {
      const c = cleanColor(body.color);
      if (!c) return NextResponse.json({ error: 'color must be #RRGGBB' }, { status: 400 });
      patch.color = c;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to change' }, { status: 400 });
    const db = createServerClient();
    const { data, error } = await db.from(ACCESS_GROUPS_TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id, name, color').maybeSingle();
    if (error) {
      if (migrationPending(error)) return pending();
      if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await db.from(ACCESS_GROUP_AUDIT_TABLE).insert({ group_id: id, action: 'update', detail: patch, actor: actorOf(caller) });
    return NextResponse.json({ group: { id: String(data.id), name: data.name, color: data.color } });
  } catch (error: any) {
    console.error('[access-groups] PATCH failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { denied, caller } = await requireAdmin(request, { write: true });
  if (denied) return denied;
  const { id } = await params;
  try {
    const db = createServerClient();
    const { data: g, error } = await db.from(ACCESS_GROUPS_TABLE).select('id, name').eq('id', id).maybeSingle();
    if (error) return migrationPending(error) ? pending() : NextResponse.json({ error: 'Failed' }, { status: 500 });
    if (!g) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // Screens first: a failed group delete must not leave a live group with no screens audit trail.
    const ena = await db.from(ENABLEMENTS_TABLE).delete().eq('scope_type', 'access_group').eq('scope_id', id);
    if (ena.error) return NextResponse.json({ error: 'Failed to clear screens' }, { status: 500 });
    const del = await db.from(ACCESS_GROUPS_TABLE).delete().eq('id', id);
    if (del.error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    await db.from(ACCESS_GROUP_AUDIT_TABLE).insert({ group_id: id, action: 'delete', detail: { name: g.name }, actor: actorOf(caller) });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[access-groups] DELETE failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
