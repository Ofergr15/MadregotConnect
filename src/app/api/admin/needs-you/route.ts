import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/needs-you — the counts behind "מה חדש?"'s "דורש אותך" (2026-10-20):
 * join requests waiting for a decision (and how long the oldest has waited) and new
 * bug reports. The feedback count comes from /api/staff/attention, which already owns
 * that rule. Only things that wait for an action; the screen hides a zero.
 */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  const [reqs, reports] = await Promise.all([
    db.from('signup_requests').select('id, created_at, athlete_id').eq('status', 'pending').neq('source', 'club-backfill').order('created_at'),
    db.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ]);
  const rows = (reqs.data ?? []) as Array<{ id: string; created_at: string; athlete_id: string | null }>;
  // A request whose person is already approved is bookkeeping, not somebody waiting.
  const ids = rows.map((r) => r.athlete_id).filter((x): x is string => !!x);
  const { data: ath } = ids.length ? await db.from('athletes').select('id, approved').in('id', ids) : { data: [] };
  const approved = new Set(((ath ?? []) as Array<{ id: string; approved: boolean | null }>).filter((a) => a.approved === true).map((a) => a.id));
  const waiting = rows.filter((r) => !r.athlete_id || !approved.has(r.athlete_id));
  const oldestDays = waiting.length ? Math.floor((Date.now() - new Date(waiting[0].created_at).getTime()) / 86_400_000) : 0;
  return NextResponse.json({ join: waiting.length, joinOldestDays: oldestDays, reports: reports.count ?? 0 });
}
