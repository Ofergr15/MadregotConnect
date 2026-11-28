import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import {
  ACADEMY_SCOPE_ID, CLUB_SCOPE_ID, SCOPE_TYPES, allowedScopeTypes, isFeatureKey, isScopeType, mayToggle, type ScopeType,
} from '@/lib/features/flags';
import { ENABLEMENTS_TABLE, ENABLEMENT_AUDIT_TABLE } from '@/lib/features/server';
import { athleteToggleFacts, managedAthletes, toggleCaller } from '@/lib/features/manage-server';

export const dynamic = 'force-dynamic';

// GET /api/features/[feature]/enablements → the caller's management screen:
//   { athletes: [{id,name,squad,isAcademy,enabled,source,coachedByCaller}], enablements, groups,
//     allowedScopes, audit: [...last 50 toggles in scope] }
//   Coach: the runners they coach. Academy manager: academy trainees (+ own coachees).
//   Admin: everyone.
// PUT /api/features/[feature]/enablements {scopeType, scopeId, enabled: true|false|null}
//   null clears the row (back to inherit). Permission from lib/features/flags mayToggle,
//   with every fact read from the DB. Every write appends to feature_enablement_audit.
export async function GET(request: Request, { params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  if (!isFeatureKey(feature)) return NextResponse.json({ error: 'unknown feature' }, { status: 404 });
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  try {
    const db = createServerClient();
    const m = await managedAthletes(db, caller, feature);
    const allowedScopes = allowedScopeTypes(toggleCaller(caller));
    const visible = new Set(m.athletes.map((a) => a.id));
    const { data: audit, error: auditErr } = await db.from(ENABLEMENT_AUDIT_TABLE)
      .select('id, scope_type, scope_id, enabled, previous, set_by, set_by_name, set_at')
      .eq('feature', feature).order('set_at', { ascending: false }).limit(200);
    const auditRows = ((audit || []) as Array<{ scope_type: ScopeType; scope_id: string }>)
      .filter((r) => r.scope_type !== 'athlete' || visible.has(r.scope_id))
      .filter((r) => r.scope_type === 'athlete' || allowedScopes.includes(r.scope_type) || allowedScopes.length === SCOPE_TYPES.length)
      .slice(0, 50);
    return NextResponse.json({
      feature, ...m,
      // Non-admins see only the rows they could have written.
      enablements: allowedScopes.length === SCOPE_TYPES.length ? m.enablements : m.enablements.filter((e) =>
        (e.scope_type === 'athlete' && visible.has(e.scope_id)) || (e.scope_type === 'academy' && allowedScopes.includes('academy'))),
      allowedScopes, audit: auditRows,
      migrationPending: auditErr ? isMissingTable(auditErr) : false,
    });
  } catch (error: any) {
    console.error('[features] GET failed', error);
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  if (!isFeatureKey(feature)) return NextResponse.json({ error: 'unknown feature' }, { status: 404 });
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const scopeType = body?.scopeType;
    let scopeId: string = typeof body?.scopeId === 'string' ? body.scopeId : '';
    const enabled: boolean | null = body?.enabled === true ? true : body?.enabled === false ? false : body?.enabled === null ? null : (undefined as never);
    if (!isScopeType(scopeType)) return NextResponse.json({ error: 'invalid scopeType' }, { status: 400 });
    if (enabled === undefined) return NextResponse.json({ error: 'enabled must be true, false or null' }, { status: 400 });
    if (scopeType === 'club') scopeId = CLUB_SCOPE_ID;
    if (scopeType === 'academy') scopeId = ACADEMY_SCOPE_ID;
    if (!scopeId) return NextResponse.json({ error: 'scopeId required' }, { status: 400 });

    const db = createServerClient();
    const athlete = scopeType === 'athlete' ? await athleteToggleFacts(db, caller, scopeId) : null;
    if (scopeType === 'athlete' && !athlete) return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
    if (!mayToggle(toggleCaller(caller), { scopeType, scopeId, athlete, feature })) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { data: prev } = await db.from(ENABLEMENTS_TABLE).select('enabled')
      .eq('feature', feature).eq('scope_type', scopeType).eq('scope_id', scopeId).maybeSingle();
    const setBy = caller.athleteId ?? caller.email;
    const now = new Date().toISOString();
    const write = enabled === null
      ? await db.from(ENABLEMENTS_TABLE).delete().eq('feature', feature).eq('scope_type', scopeType).eq('scope_id', scopeId)
      : await db.from(ENABLEMENTS_TABLE).upsert(
        { feature, scope_type: scopeType, scope_id: scopeId, enabled, set_by: setBy, set_at: now },
        { onConflict: 'feature,scope_type,scope_id' },
      );
    if (write.error) {
      if (isMissingTable(write.error)) return NextResponse.json({ error: 'migration_pending', details: 'migration 191 not applied' }, { status: 503 });
      return NextResponse.json({ error: 'Failed to save', details: write.error.message }, { status: 500 });
    }
    const { data: me } = caller.athleteId ? await db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle() : { data: null };
    await db.from(ENABLEMENT_AUDIT_TABLE).insert({
      feature, scope_type: scopeType, scope_id: scopeId, enabled, previous: prev?.enabled ?? null,
      set_by: setBy, set_by_name: me?.name ?? null, set_at: now,
    });
    return NextResponse.json({ ok: true, scopeType, scopeId, enabled, setBy, setAt: now });
  } catch (error: any) {
    console.error('[features] PUT failed', error);
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}
