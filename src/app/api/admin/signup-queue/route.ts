import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import {
  REJECT_REASONS,
  REJECT_REASON_LABELS_HE,
  UNDO_WINDOW_MS,
  canUndo,
  decideReject,
  decideUndo,
  undoDeadline,
  withoutReasonColumns,
  type SignupRow,
} from '@/lib/signup-decisions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /api/admin/signup-queue — the approval queue with reasons and an undo window.
 *
 * GET  → { pending[], undoable[], reasons[], undoWindowMs }
 *        pending oldest first; undoable = rejections still inside the window.
 * POST { id, action: 'reject', reason, note? } → { ok, status: 'rejected', undoUntil }
 * POST { id, action: 'undo' }                  → { ok, status: 'pending' }
 *
 * Approval stays on POST /api/admin/registrations/approve (it mails the link).
 * Same gate as that route: the session's canApprove. This lists strangers' email
 * addresses, so a signed-in member must never read it.
 *
 * Reasons live in `decision_reason` / `decision_note` (migration 240). Until it is
 * pasted the route still works and answers `reasonStored: false`.
 */

const SELECT = 'id, email, group_id, status, created_at, rejected_at, rejected_by';
const SELECT_WITH_REASON = `${SELECT}, decision_reason, decision_note`;

function missingColumn(err: { code?: string } | null | undefined) {
  return err?.code === '42703' || err?.code === 'PGRST204';
}

async function gate(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth), email: null };
  if (!auth.user.canApprove) {
    return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }), email: null };
  }
  return { denied: null, email: auth.user.email || null };
}

export async function GET(request: Request) {
  try {
    const { denied } = await gate(request);
    if (denied) return denied;
    const supabase = createServerClient();
    const now = new Date();
    const since = new Date(now.getTime() - UNDO_WINDOW_MS).toISOString();

    const read = (select: string) =>
      Promise.all([
        supabase.from('signup_requests').select(select).eq('status', 'pending').order('created_at', { ascending: true }),
        supabase.from('signup_requests').select(select).eq('status', 'rejected').gte('rejected_at', since)
          .order('rejected_at', { ascending: false }),
      ]);

    let reasonStored = true;
    let [pending, recent] = await read(SELECT_WITH_REASON);
    if (missingColumn(pending.error) || missingColumn(recent.error)) {
      reasonStored = false;
      [pending, recent] = await read(SELECT);
    }
    if (pending.error?.code === '42P01') {
      return NextResponse.json({ pending: [], undoable: [], migrated: false });
    }
    if (pending.error) throw pending.error;
    if (recent.error) throw recent.error;

    const undoable = ((recent.data || []) as unknown as Array<SignupRow & Record<string, unknown>>)
      .filter((r) => canUndo(r, now))
      .map((r) => ({ ...r, undoUntil: undoDeadline(r)?.toISOString() ?? null }));

    return NextResponse.json({
      pending: pending.data || [],
      undoable,
      reasons: REJECT_REASONS.map((code) => ({ code, label: REJECT_REASON_LABELS_HE[code] })),
      undoWindowMs: UNDO_WINDOW_MS,
      reasonStored,
    });
  } catch (error) {
    console.error('[signup-queue] GET failed', error);
    return NextResponse.json({ error: 'Failed to load the queue' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied, email } = await gate(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown; action?: unknown; reason?: unknown; note?: unknown;
    };
    if (typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (body.action !== 'reject' && body.action !== 'undo') {
      return NextResponse.json({ error: "action must be 'reject' or 'undo'" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: row, error: findError } = await supabase
      .from('signup_requests')
      .select('id, status, rejected_at')
      .eq('id', body.id)
      .maybeSingle();
    if (findError) throw findError;
    if (!row) return NextResponse.json({ error: 'Registration not found' }, { status: 404 });

    const now = new Date();
    const decision = body.action === 'reject'
      ? decideReject(row as SignupRow, { reason: body.reason, note: body.note }, email, now)
      : decideUndo(row as SignupRow, now);
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

    // Conditional on the status we read, so two approvers racing can't both win.
    const write = (patch: Record<string, unknown>) =>
      supabase.from('signup_requests').update(patch).eq('id', body.id as string).eq('status', row.status).select('id');

    let reasonStored = true;
    let res = await write(decision.patch);
    if (missingColumn(res.error)) {
      reasonStored = false;
      res = await write(withoutReasonColumns(decision.patch));
    }
    if (res.error?.code === '23505') {
      // Undo would create a second pending request for the same address.
      return NextResponse.json({ error: 'a newer pending request exists for this address' }, { status: 409 });
    }
    if (res.error) throw res.error;
    if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
      return NextResponse.json({ error: 'changed by someone else, reload' }, { status: 409 });
    }

    if (body.action === 'reject') {
      return NextResponse.json({
        ok: true,
        status: 'rejected',
        undoUntil: new Date(now.getTime() + UNDO_WINDOW_MS).toISOString(),
        reasonStored,
      });
    }
    return NextResponse.json({ ok: true, status: 'pending', reasonStored });
  } catch (error) {
    console.error('[signup-queue] POST failed', error);
    return NextResponse.json({ error: 'Failed to update the request' }, { status: 500 });
  }
}
