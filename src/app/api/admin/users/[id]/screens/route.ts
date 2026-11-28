import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/access-groups/gate';
import { ACCESS_GROUPS_TABLE } from '@/lib/access-groups/store';
import { FEATURES, FEATURE_KEYS, resolveFeature } from '@/lib/features/flags';
import { athleteFacts, enablementRowsFor } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

const ROLE_HE: Record<string, string> = {
  admin: 'מנהל', coach: 'מאמן', academy_coach: 'מאמן אקדמיה', core_runner: 'גרעין', runner: 'רץ', viewer: 'צופה', academy_manager: 'מנהל אקדמיה',
};

// GET /api/admin/users/{id}/screens → the user page under ניהול → משתמשים (admin-only):
//   { athlete: {id,name,role,extraRoles}, groups: [{id,name,color}],
//     screens: [{key,label,enabled,source:{scopeType,scopeId,label}|null,personal:bool|null}] }
// A personal override is written through PUT /api/features/{key}/enablements (scopeType 'athlete').
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requireAdmin(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const db = createServerClient();
    const [facts, rows, { data: who }] = await Promise.all([
      athleteFacts(id, db),
      enablementRowsFor(FEATURE_KEYS, db),
      db.from('athletes').select('id, name, avatar_url').eq('id', id).maybeSingle(),
    ]);
    if (!facts || !who) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const ids = facts.accessGroupIds ?? [];
    const { data: gs } = ids.length ? await db.from(ACCESS_GROUPS_TABLE).select('id, name, color').in('id', ids) : { data: [] };
    const groups = ((gs || []) as Array<{ id: string; name: string; color: string }>).map((g) => ({ id: String(g.id), name: g.name, color: g.color }));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const all = rows ?? [];
    const screens = FEATURE_KEYS.map((key) => {
      const r = resolveFeature(key, all, facts);
      const own = all.find((x) => x.feature === key && x.scope_type === 'athlete' && x.scope_id === id);
      const s = r.source;
      const label = !s ? 'ברירת מחדל'
        : s.scopeType === 'athlete' ? 'אישי'
        : s.scopeType === 'access_group' ? groupName.get(s.scopeId) ?? 'קבוצה'
        : s.scopeType === 'role' ? ROLE_HE[s.scopeId] ?? s.scopeId
        : s.scopeType === 'squad' ? 'דבוקה'
        : s.scopeType === 'academy' ? 'אקדמיה'
        : 'כל המועדון';
      return {
        key, label: FEATURES[key].label, enabled: r.enabled,
        source: s ? { scopeType: s.scopeType, scopeId: s.scopeId, label } : null,
        personal: own ? !!own.enabled : null,
      };
    });
    return NextResponse.json({
      athlete: { id, name: who.name, avatarUrl: who.avatar_url, role: facts.role ?? null, extraRoles: facts.extraRoles ?? [] },
      groups, screens, migrationPending: rows === null,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    console.error('[admin/users/screens] GET failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
