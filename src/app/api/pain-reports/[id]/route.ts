import { NextResponse } from 'next/server';
import { PAIN_SELECT, painDetail, shapePain, type PainRow } from '@/lib/feedback/pain-server';
import { EFFECTS, SIDES, SINCE } from '@/lib/feedback/pain';
import { loadPain } from './load';

export const dynamic = 'force-dynamic';

// GET   /api/pain-reports/[id]  → detail (owner or scoped staff). A staff read stamps seen_at.
// PATCH /api/pain-reports/[id]  {severity?, side?, since?, effect?, note?} | {withdraw: true} → owner only.
//        Withdraw is SOFT: the row stays and staff see it as "בוטל".
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'any');
  if (l.res) return l.res;
  if (l.access === 'staff' && !l.row.seen_at && !l.caller.viewingAsBy) {
    const seen = new Date().toISOString();
    await l.db.from('pain_reports').update({ seen_at: seen, seen_by: l.caller.athleteId ?? l.caller.email }).eq('id', id);
    l.row.seen_at = seen;
  }
  return NextResponse.json({ report: await painDetail(l.db, l.row, l.caller.athleteId) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await loadPain(request, id, 'owner');
  if (l.res) return l.res;
  if (l.caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body?.withdraw === true) {
    if (l.row.status === 'withdrawn') return NextResponse.json({ report: shapePain(l.row) });
    patch = { status: 'withdrawn', withdrawn_at: now };
  } else {
    if (l.row.status !== 'open') return NextResponse.json({ error: 'report is closed' }, { status: 409 });
    patch = { edited_at: now };
    if (body.severity != null) {
      if (!Number.isInteger(body.severity) || body.severity < 1 || body.severity > 10) return NextResponse.json({ error: 'invalid severity' }, { status: 400 });
      patch.severity = body.severity;
    }
    if (body.side !== undefined) {
      if (body.side !== null && !(SIDES as readonly string[]).includes(body.side)) return NextResponse.json({ error: 'invalid side' }, { status: 400 });
      patch.side = body.side;
    }
    if (body.since != null) {
      if (!(SINCE as readonly string[]).includes(body.since)) return NextResponse.json({ error: 'invalid since' }, { status: 400 });
      patch.since = body.since;
    }
    if (body.effect != null) {
      if (!(EFFECTS as readonly string[]).includes(body.effect)) return NextResponse.json({ error: 'invalid effect' }, { status: 400 });
      patch.effect = body.effect;
    }
    if (body.note !== undefined) patch.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
  }
  const { data, error } = await l.db.from('pain_reports').update(patch).eq('id', id).select(PAIN_SELECT).single();
  if (error) { console.error('[api/pain-reports/[id]]', error); return NextResponse.json({ error: 'Failed to update' }, { status: 500 }); }
  return NextResponse.json({ report: shapePain(data as PainRow) });
}
