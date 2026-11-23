import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * Staff decide pack-change requests (BUILD-BRIEF gap 4, decision: decided in the app).
 *   GET                                   → { requests: [{ id, athleteId, name, fromGroupId, toGroupId, note, createdAt }] }
 *   POST { id, decision: 'approve'|'decline' } → { ok, status }
 * Staff-gated from the verified JWT. Approving moves athletes.group_id — the same
 * write staff already make through /api/athletes — and only while still pending.
 */
export async function GET(request: Request) {
  const gate = await requireStaffCaller(request);
  if (gate.denied) return gate.denied;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('group_change_requests')
    .select('id, athlete_id, from_group_id, to_group_id, note, created_at, athletes!athlete_id(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ requests: [], notReady: true });
    console.error('[api/admin/group-change-requests]', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return NextResponse.json({
    requests: (data || []).map((r) => ({
      id: r.id, athleteId: r.athlete_id, name: (r.athletes as { name?: string } | null)?.name ?? null,
      fromGroupId: r.from_group_id, toGroupId: r.to_group_id, note: r.note, createdAt: r.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireStaffCaller(request);
  if (gate.denied) return gate.denied;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; decision?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id || (body.decision !== 'approve' && body.decision !== 'decline')) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const supabase = createServerClient();
  const status = body.decision === 'approve' ? 'approved' : 'declined';
  const { data: claimed, error } = await supabase
    .from('group_change_requests')
    .update({ status, decided_at: new Date().toISOString(), decided_by: gate.caller.athleteId })
    .eq('id', id).eq('status', 'pending')
    .select('athlete_id, to_group_id');
  if (error) { console.error('[api/admin/group-change-requests]', error); return NextResponse.json({ error: 'failed' }, { status: 500 }); }
  if (!claimed || claimed.length === 0) return NextResponse.json({ ok: true, alreadyHandled: true });
  if (status === 'approved') {
    const { error: moveError } = await supabase.from('athletes').update({ group_id: claimed[0].to_group_id }).eq('id', claimed[0].athlete_id);
    if (moveError) { console.error('[api/admin/group-change-requests]', moveError); return NextResponse.json({ error: 'failed' }, { status: 500 }); }
  }
  return NextResponse.json({ ok: true, status });
}
