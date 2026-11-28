import { NextResponse } from 'next/server';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { mayFollowUp } from '@/lib/feedback/pain-followup-server';
import { isFollowupStatus, parseFollowupInput, shapeFollowup, type FollowupRow, type FollowupStatus } from '@/lib/feedback/pain-followup';
import { loadPain } from '../load';

export const dynamic = 'force-dynamic';

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 });

/**
 * Staff follow-up on one pain report (task 187, migration 351).
 *
 * GET  → { status, updatedAt, notes[] }
 * POST { status?: 'open'|'contacted'|'closed', note?: string } → one follow-up row + the status
 *
 * Only the report's routed recipients (lib/feedback/pain-followup-server mayFollowUp) and
 * admins. The runner gets 403 — these notes are about them, never for them, and no member
 * response (GET /api/pain-reports/{id}, the list) carries them. Push-free.
 * Before 351: GET answers `migrationPending`, POST 503.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'staff');
  if (l.res) return l.res;
  if (!(await mayFollowUp(l.db, l.caller, l.row.athlete_id))) return forbidden();
  const [st, notes] = await Promise.all([
    l.db.from('pain_reports').select('followup_status, followup_updated_at').eq('id', id).maybeSingle(),
    l.db.from('pain_report_followups').select('id, author_id, status_from, status_to, note, created_at').eq('report_id', id).order('created_at'),
  ]);
  if ((st.error && isMissingColumn(st.error)) || (notes.error && isMissingTable(notes.error))) {
    return NextResponse.json({ status: 'open', updatedAt: null, notes: [], migrationPending: true });
  }
  if (st.error || notes.error) return NextResponse.json({ error: 'Failed to load follow-up' }, { status: 500 });
  const rows = (notes.data || []) as FollowupRow[];
  const authorIds = [...new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (authorIds.length) {
    const { data } = await l.db.from('athletes').select('id, name').in('id', authorIds);
    for (const a of (data || []) as Array<{ id: string; name: string | null }>) names.set(a.id, a.name || '');
  }
  const s = st.data as { followup_status?: string; followup_updated_at?: string | null } | null;
  return NextResponse.json({
    status: isFollowupStatus(s?.followup_status) ? s!.followup_status : 'open',
    updatedAt: s?.followup_updated_at ?? null,
    notes: rows.map((r) => shapeFollowup(r, names)),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'staff');
  if (l.res) return l.res;
  if (l.caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  if (!(await mayFollowUp(l.db, l.caller, l.row.athlete_id))) return forbidden();
  const parsed = parseFollowupInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { status, note } = parsed.value;

  const cur = await l.db.from('pain_reports').select('followup_status').eq('id', id).maybeSingle();
  if (cur.error) {
    if (isMissingColumn(cur.error)) return NextResponse.json({ error: 'migration 351 pending' }, { status: 503 });
    return NextResponse.json({ error: 'Failed to save follow-up' }, { status: 500 });
  }
  const from = ((cur.data as { followup_status?: string } | null)?.followup_status ?? 'open') as FollowupStatus;
  const to = status && status !== from ? status : null;
  if (!to && !note) return NextResponse.json({ ok: true, status: from, changed: false });

  const authorId = l.caller.athleteId;
  const ins = await l.db.from('pain_report_followups').insert({ report_id: id, author_id: authorId, status_from: to ? from : null, status_to: to, note });
  if (ins.error) {
    if (isMissingTable(ins.error)) return NextResponse.json({ error: 'migration 351 pending' }, { status: 503 });
    return NextResponse.json({ error: 'Failed to save follow-up' }, { status: 500 });
  }
  if (to) {
    const up = await l.db.from('pain_reports')
      .update({ followup_status: to, followup_updated_at: new Date().toISOString(), followup_updated_by: authorId })
      .eq('id', id);
    if (up.error) return NextResponse.json({ error: 'Failed to save follow-up' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: to ?? from, changed: !!to });
}
