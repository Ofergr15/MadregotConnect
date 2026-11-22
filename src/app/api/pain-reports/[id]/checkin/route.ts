import { NextResponse } from 'next/server';
import { TRENDS } from '@/lib/feedback/pain';
import { PAIN_SELECT, shapePain, type PainRow } from '@/lib/feedback/pain-server';
import { loadPain } from '../load';

export const dynamic = 'force-dynamic';

// POST /api/pain-reports/[id]/checkin {trend: better|same|worse|gone, severity?} → owner only.
// "gone" resolves the report (resolved_by 'runner') and stops the follow-ups.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'owner');
  if (l.res) return l.res;
  if (l.caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  if (l.row.status !== 'open') return NextResponse.json({ error: 'report is closed' }, { status: 409 });
  const body = await request.json().catch(() => ({}));
  if (!(TRENDS as readonly string[]).includes(body?.trend)) return NextResponse.json({ error: 'invalid trend' }, { status: 400 });
  const sev = body.severity == null ? null : Number(body.severity);
  if (sev != null && (!Number.isInteger(sev) || sev < 1 || sev > 10)) return NextResponse.json({ error: 'invalid severity' }, { status: 400 });
  const { error } = await l.db.from('pain_checkins').insert({ report_id: id, trend: body.trend, severity: sev });
  if (error) return NextResponse.json({ error: 'Failed to save', details: error.message }, { status: 500 });
  let row = l.row;
  const patch: Record<string, unknown> = {};
  if (sev != null) patch.severity = sev;
  if (body.trend === 'gone') Object.assign(patch, { status: 'resolved', resolved_by: 'runner', resolved_at: new Date().toISOString() });
  if (Object.keys(patch).length) {
    const { data } = await l.db.from('pain_reports').update(patch).eq('id', id).select(PAIN_SELECT).single();
    if (data) row = data as PainRow;
  }
  return NextResponse.json({ report: shapePain(row) });
}
