import { NextResponse } from 'next/server';
import { PAIN_SELECT, shapePain, type PainRow } from '@/lib/feedback/pain-server';
import { loadPain } from '../load';

export const dynamic = 'force-dynamic';

// POST /api/pain-reports/[id]/close → scoped staff only. Stops the follow-ups.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'staff');
  if (l.res) return l.res;
  if (l.caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  if (l.row.status !== 'open') return NextResponse.json({ report: shapePain(l.row) });
  const now = new Date().toISOString();
  const { data, error } = await l.db.from('pain_reports')
    .update({ status: 'resolved', resolved_by: l.caller.athleteId ?? l.caller.email, resolved_at: now, seen_at: l.row.seen_at ?? now })
    .eq('id', id).select(PAIN_SELECT).single();
  if (error) { console.error('[api/pain-reports/[id]/close]', error); return NextResponse.json({ error: 'Failed to close' }, { status: 500 }); }
  return NextResponse.json({ report: shapePain(data as PainRow) });
}
