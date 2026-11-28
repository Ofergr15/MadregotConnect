import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { actorOf, pending, requireAdmin } from '@/lib/access-groups/gate';
import { ACCESS_GROUPS_TABLE, migrationPending } from '@/lib/access-groups/store';
import { isFeatureKey } from '@/lib/features/flags';
import { ENABLEMENTS_TABLE, ENABLEMENT_AUDIT_TABLE } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

// PUT {feature, enabled: true|false|null} — one screen for one group. null clears (back to inherit).
// Same table and audit as PUT /api/features/{key}/enablements, scope_type 'access_group'.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, caller } = await requireAdmin(request, { write: true });
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const feature = body?.feature;
    if (!isFeatureKey(feature)) return NextResponse.json({ error: 'unknown feature' }, { status: 400 });
    const enabled = body?.enabled === true ? true : body?.enabled === false ? false : body?.enabled === null ? null : undefined;
    if (enabled === undefined) return NextResponse.json({ error: 'enabled must be true, false or null' }, { status: 400 });
    const db = createServerClient();
    const { data: g, error: gErr } = await db.from(ACCESS_GROUPS_TABLE).select('id').eq('id', id).maybeSingle();
    if (gErr) return migrationPending(gErr) ? pending() : NextResponse.json({ error: 'Failed' }, { status: 500 });
    if (!g) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const { data: prev } = await db.from(ENABLEMENTS_TABLE).select('enabled')
      .eq('feature', feature).eq('scope_type', 'access_group').eq('scope_id', id).maybeSingle();
    const setBy = actorOf(caller);
    const now = new Date().toISOString();
    const write = enabled === null
      ? await db.from(ENABLEMENTS_TABLE).delete().eq('feature', feature).eq('scope_type', 'access_group').eq('scope_id', id)
      : await db.from(ENABLEMENTS_TABLE).upsert(
        { feature, scope_type: 'access_group', scope_id: id, enabled, set_by: setBy, set_at: now },
        { onConflict: 'feature,scope_type,scope_id' },
      );
    if (write.error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    const { data: me } = caller.athleteId ? await db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle() : { data: null };
    await db.from(ENABLEMENT_AUDIT_TABLE).insert({
      feature, scope_type: 'access_group', scope_id: id, enabled, previous: prev?.enabled ?? null,
      set_by: setBy, set_by_name: me?.name ?? null, set_at: now,
    });
    return NextResponse.json({ ok: true, feature, enabled, setAt: now });
  } catch (error: any) {
    console.error('[access-groups] screens PUT failed', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
