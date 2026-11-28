import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { actorOf, pending, requireAdmin } from '@/lib/access-groups/gate';
import {
  ACCESS_GROUPS_TABLE, ACCESS_GROUP_AUDIT_TABLE, ACCESS_GROUP_MEMBERS_TABLE, cleanColor, cleanGroupName, migrationPending,
} from '@/lib/access-groups/store';
import { ENABLEMENTS_TABLE } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

// GET  /api/admin/access-groups → { groups: [{id,name,color,memberCount,memberIds,screens:{feature:bool}}] }
// POST /api/admin/access-groups {name, color} → { group }
// Admin-only (lib/access-groups/gate). Design: review-2026-11-20/access-groups-design.md.
export async function GET(request: Request) {
  const { denied } = await requireAdmin(request);
  if (denied) return denied;
  try {
    const db = createServerClient();
    const { data: groups, error } = await db.from(ACCESS_GROUPS_TABLE).select('id, name, color, created_at').order('created_at');
    if (error) return migrationPending(error) ? pending() : NextResponse.json({ error: 'Failed' }, { status: 500 });
    const [{ data: members }, { data: rows }] = await Promise.all([
      db.from(ACCESS_GROUP_MEMBERS_TABLE).select('group_id, athlete_id'),
      db.from(ENABLEMENTS_TABLE).select('feature, scope_id, enabled').eq('scope_type', 'access_group'),
    ]);
    const out = ((groups || []) as Array<{ id: string; name: string; color: string }>).map((g) => {
      const memberIds = ((members || []) as Array<{ group_id: string; athlete_id: string }>)
        .filter((m) => String(m.group_id) === String(g.id)).map((m) => String(m.athlete_id));
      const screens: Record<string, boolean> = {};
      for (const r of (rows || []) as Array<{ feature: string; scope_id: string; enabled: boolean }>) {
        if (r.scope_id === String(g.id)) screens[r.feature] = !!r.enabled;
      }
      return { id: String(g.id), name: g.name, color: g.color, memberCount: memberIds.length, memberIds, screens };
    });
    return NextResponse.json({ groups: out });
  } catch (error: any) {
    console.error('[access-groups] GET failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { denied, caller } = await requireAdmin(request, { write: true });
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const name = cleanGroupName(body?.name);
    if (!name) return NextResponse.json({ error: 'name must be 1–60 characters' }, { status: 400 });
    const color = body?.color === undefined ? '#1C1C1E' : cleanColor(body?.color);
    if (!color) return NextResponse.json({ error: 'color must be #RRGGBB' }, { status: 400 });
    const db = createServerClient();
    const actor = actorOf(caller);
    const { data, error } = await db.from(ACCESS_GROUPS_TABLE).insert({ name, color, created_by: actor }).select('id, name, color').single();
    if (error) {
      if (migrationPending(error)) return pending();
      if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
      return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
    }
    await db.from(ACCESS_GROUP_AUDIT_TABLE).insert({ group_id: data.id, action: 'create', detail: { name, color }, actor });
    return NextResponse.json({ group: { id: String(data.id), name: data.name, color: data.color, memberCount: 0, memberIds: [], screens: {} } }, { status: 201 });
  } catch (error: any) {
    console.error('[access-groups] POST failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
