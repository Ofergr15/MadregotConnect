import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { planWeekStartOf } from '@/lib/utils';
import { isMomentKind } from '@/lib/academy/week-moments';
import { sendMoment, MomentsNotMigrated } from '@/lib/academy/week-moments-server';

export const dynamic = 'force-dynamic';

/**
 * POST { weekStart, kind, at? } — send the caller's saved moment now, or at `at` (ISO, future). The press IS the
 * send: a scheduled one goes out from the tick only because this was pressed (doc p.1: nothing on its own).
 * WHO: the author (JWT). 409 when there is nothing saved yet, or it was already sent.
 */
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
  // Gated rollout: academy_week_moments is enforced on the write and the send, not only in the app.
  if (!(await isFeatureEnabled('academy_week_moments', caller.athleteId).catch(() => false))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isMomentKind(b.kind)) return NextResponse.json({ error: 'kind is required' }, { status: 400 });
    const weekStart = planWeekStartOf(typeof b.weekStart === 'string' ? b.weekStart : null);
    const db = createServerClient();
    const { data: m, error } = await db.from('academy_week_moments').select('id, sent_at')
      .eq('week_start', weekStart).eq('kind', b.kind).eq('author_id', caller.athleteId).maybeSingle();
    if (error && /does not exist|schema cache/i.test(error.message || '')) return NextResponse.json({ error: 'migration 212 not applied', code: 'migration_pending' }, { status: 503 });
    const row = m as { id: string; sent_at: string | null } | null;
    if (!row) return NextResponse.json({ error: 'save it first', code: 'not_saved' }, { status: 409 });
    if (row.sent_at) return NextResponse.json({ error: 'already sent', code: 'sent' }, { status: 409 });
    const now = new Date();
    const at = typeof b.at === 'string' ? new Date(b.at) : null;
    if (at && !Number.isNaN(at.getTime()) && at.getTime() > now.getTime() + 60_000) {
      if (at.getTime() > now.getTime() + 8 * 86_400_000) return NextResponse.json({ error: 'at is too far ahead' }, { status: 400 });
      await db.from('academy_week_moments').update({ scheduled_at: at.toISOString(), updated_at: now.toISOString() }).eq('id', row.id);
      return NextResponse.json({ scheduledAt: at.toISOString() });
    }
    const r = await sendMoment(db, row.id, now.toISOString());
    return NextResponse.json({ sentAt: now.toISOString(), recipients: r.sent, ...(r.already ? { already: true } : {}) });
  } catch (e) {
    if (e instanceof MomentsNotMigrated) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    console.error('POST /api/academy/week-moments/send', e);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}
