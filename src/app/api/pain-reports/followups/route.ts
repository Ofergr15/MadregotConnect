import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { PAIN_SELECT, shapePain, type PainRow } from '@/lib/feedback/pain-server';
import { mayFollowUp } from '@/lib/feedback/pain-followup-server';
import { isFollowupStatus } from '@/lib/feedback/pain-followup';

export const dynamic = 'force-dynamic';

const LIMIT = 200;

/**
 * GET /api/pain-reports/followups?status=open|contacted|closed (default: everything not closed)
 *
 * The caller's follow-up queue (task 187): pain reports whose alert is routed to them
 * (mayFollowUp), newest first, with the follow-up status. Staff only; a member gets 403
 * before any read. Before migration 351: `migrationPending`.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isStaff && !caller.isSuperUser) return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
  const asked = new URL(request.url).searchParams.get('status');
  if (asked != null && !isFollowupStatus(asked)) return NextResponse.json({ error: 'status must be open, contacted or closed' }, { status: 400 });
  const db = createServerClient();
  let q = db.from('pain_reports').select(`${PAIN_SELECT}, followup_status, followup_updated_at, athletes!athlete_id(name)`);
  q = asked ? q.eq('followup_status', asked) : q.neq('followup_status', 'closed');
  const { data, error } = await q.order('created_at', { ascending: false }).limit(LIMIT);
  if (error) {
    if (isMissingColumn(error)) return NextResponse.json({ items: [], migrationPending: true });
    return NextResponse.json({ error: 'Failed to load follow-ups' }, { status: 500 });
  }
  const cache = new Map<string, string[]>();
  const items = [];
  for (const r of (data || []) as unknown as Array<PainRow & { followup_status: string; followup_updated_at: string | null; athletes?: { name?: string } | null }>) {
    if (!(await mayFollowUp(db, caller, r.athlete_id, cache))) continue;
    items.push({ ...shapePain(r), athleteName: r.athletes?.name ?? null, followupStatus: r.followup_status, followupUpdatedAt: r.followup_updated_at });
  }
  return NextResponse.json({ items, truncated: (data || []).length === LIMIT });
}
