import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { notifyStaff } from '@/lib/notifications/staff';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * "Delete my account" — a REQUEST to admin, never a deletion (settings rev 3 Q5).
 *
 * Self only: the athlete comes from the verified session, never the body, so no
 * caller can file one for somebody else (this would otherwise be exactly the
 * "deletion driven by a body field" CLAUDE.md forbids). Routed through
 * `recipientsForKind('account_delete_request')` (admin by default, migration 193;
 * notifyStaff falls back to the hardcoded staff list while 193 is unapplied).
 * The admin carries it out with `select anonymise_athlete('<id>')`: the person's
 * identity goes, their rows in coach and club stats stay, anonymised.
 *
 * GET  → { request: { status, createdAt } | null, migrated }
 * POST { reason? } → { request } (idempotent: a pending one is returned as is)
 * DELETE → cancels a pending request.
 */
const SLA_DAYS = 7;

async function caller(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!caller.athleteId) return { denied: NextResponse.json({ error: 'no athlete' }, { status: 403 }) };
  return { athleteId: caller.athleteId };
}
const unmigrated = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || /account_deletion_requests/.test(e.message || ''));
const shape = (r: { status: string; created_at: string } | null) => r ? { status: r.status, createdAt: r.created_at, slaDays: SLA_DAYS } : null;

export async function GET(request: Request) {
  const c = await caller(request);
  if (c.denied) return c.denied;
  const db = createServerClient();
  const { data, error } = await db.from('account_deletion_requests').select('status, created_at')
    .eq('athlete_id', c.athleteId).eq('status', 'pending').maybeSingle();
  if (unmigrated(error)) return NextResponse.json({ request: null, migrated: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: shape(data), migrated: true });
}

export async function POST(request: Request) {
  try {
    const c = await caller(request);
    if (c.denied) return c.denied;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
    const db = createServerClient();
    const existing = await db.from('account_deletion_requests').select('status, created_at')
      .eq('athlete_id', c.athleteId).eq('status', 'pending').maybeSingle();
    if (unmigrated(existing.error)) return NextResponse.json({ error: 'account_deletion_requests not migrated yet (193)' }, { status: 503 });
    if (existing.data) return NextResponse.json({ request: shape(existing.data) });
    const { data, error } = await db.from('account_deletion_requests')
      .insert({ athlete_id: c.athleteId, reason }).select('status, created_at').single();
    if (error) throw error;
    const { data: who } = await db.from('athletes').select('name').eq('id', c.athleteId).maybeSingle();
    const name = (who as { name?: string } | null)?.name || 'רץ/ה';
    await notifyStaff({
      kind: 'account_delete_request',
      url: `/dashboard/settings?athlete=${c.athleteId}`,
      tag: `delete-request-${c.athleteId}`,
      category: 'management',
      actorAthleteId: c.athleteId,
      copy: (locale) => locale === 'en'
        ? { title: 'Account deletion request', body: `${name} asked to delete their account — handle within ${SLA_DAYS} days.` }
        : { title: 'בקשה למחיקת חשבון', body: `${name} ביקש/ה למחוק את החשבון — לטפל תוך ${SLA_DAYS} ימים.` },
    });
    return NextResponse.json({ request: shape(data) });
  } catch (err: unknown) {
    console.error('[account/delete-request] failed:', err);
    return NextResponse.json(internalErrorBody('Failed'), { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const c = await caller(request);
  if (c.denied) return c.denied;
  const db = createServerClient();
  const { error } = await db.from('account_deletion_requests').update({ status: 'cancelled', handled_at: new Date().toISOString() })
    .eq('athlete_id', c.athleteId).eq('status', 'pending');
  if (unmigrated(error)) return NextResponse.json({ request: null, migrated: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: null });
}
