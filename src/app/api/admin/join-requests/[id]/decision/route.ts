import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { cleanReason, suggestGroup, type GroupSuggestion } from '@/lib/join/suggest-group';
import { POST as decideRegistration } from '@/app/api/admin/registrations/approve/route';
import { loadPackGoals } from '../../load';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/join-requests/{id}/decision
 * Body: { action: 'approve' | 'reject', reason?: string, groupId?: string, acceptSuggestion?: boolean }
 *
 * The decision itself is NOT reimplemented here: it goes through
 * /api/admin/registrations/approve, the one path that creates the athlete row and sends the
 * link, so the two can never disagree on what approval means. What this adds (task 186):
 *
 *  - a reason: REQUIRED to reject, optional to approve, ≤280 chars, staff-only;
 *  - the pace suggestion: `acceptSuggestion: true` with no `groupId` approves into the pack
 *    the applicant's best time points at. Never implied — without it the approver's group
 *    (or the one the applicant picked) is used, and no group is still a 400 from approve;
 *  - an audit row (join_request_audit, migration 350) once the decision is committed.
 *    Before 350 the decision still goes through and the reply says `auditStored: false`.
 *
 * Gate: `canApprove`, checked here before anything is read, and again by approve.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.canApprove) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const action = body.action;
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
  const reason = cleanReason(body.reason);
  if (action === 'reject' && !reason) return NextResponse.json({ error: 'reason-required' }, { status: 400 });
  if (body.groupId != null && typeof body.groupId !== 'string') return NextResponse.json({ error: 'groupId must be a string' }, { status: 400 });

  try {
    const db = createServerClient();
    let found = await db.from('signup_requests').select('id, status, group_id, intake').eq('id', id).maybeSingle();
    if (found.error && isMissingColumn(found.error)) found = await db.from('signup_requests').select('id, status, group_id').eq('id', id).maybeSingle();
    if (found.error) throw found.error;
    const req = found.data as { id: string; status: string; group_id: string | null; intake?: unknown } | null;
    if (!req) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const suggestion: GroupSuggestion = suggestGroup(req.intake, await loadPackGoals(db));
    let groupId: string | null | undefined;
    let groupSource: 'approver' | 'suggestion' | 'request' | null = null;
    if (action === 'approve') {
      if (typeof body.groupId === 'string' && body.groupId) { groupId = body.groupId; groupSource = 'approver'; }
      else if (body.acceptSuggestion === true) {
        if (suggestion.kind !== 'group') return NextResponse.json({ error: 'no-suggestion', suggestion }, { status: 400 });
        groupId = suggestion.groupId; groupSource = 'suggestion';
      } else if (req.group_id) { groupSource = 'request'; }
    }

    const forwarded = new Request(new URL('/api/admin/registrations/approve', request.url), {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ id, action, ...(groupId ? { groupId } : {}) }),
    });
    const res = await decideRegistration(forwarded);
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || out.alreadyHandled) return NextResponse.json({ ...out, suggestion }, { status: res.status });

    const audit = await db.from('join_request_audit').insert({
      request_id: id,
      action,
      reason,
      group_id: action === 'approve' ? groupId ?? req.group_id : null,
      suggested_group_id: suggestion.kind === 'group' ? suggestion.groupId : null,
      suggestion_kind: suggestion.kind,
      group_source: groupSource,
      actor_email: auth.user.email || null,
      actor_athlete_id: auth.user.athleteId ?? null,
    });
    if (audit.error && !isMissingTable(audit.error)) console.error('join_request_audit insert failed:', audit.error);
    return NextResponse.json({ ...out, suggestion, reason, groupSource, auditStored: !audit.error });
  } catch (err) {
    console.error('POST /api/admin/join-requests/[id]/decision failed:', err);
    return NextResponse.json({ error: 'Failed to decide join request' }, { status: 500 });
  }
}
