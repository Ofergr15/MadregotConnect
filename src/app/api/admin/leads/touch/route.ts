import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isLeadRef } from '@/lib/admin/leads';

export const dynamic = 'force-dynamic';

const KINDS = ['call', 'message', 'note'] as const;

// POST /api/admin/leads/touch { leadRef, kind: call|message|note, note?, at? }
//
// Staff only. The author is the verified caller — never a body field — so the log
// can't be written in somebody else's name.
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireStaffCaller(request);
    if (denied) return denied;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const leadRef = body?.leadRef;
    const kind = body?.kind;
    if (!isLeadRef(leadRef)) return NextResponse.json({ error: 'leadRef must be signup:<id>, academy:<id> or u21:<id>' }, { status: 400 });
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: 'kind must be call, message or note' }, { status: 400 });
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) || null : null;
    if (kind === 'note' && !note) return NextResponse.json({ error: 'A note needs text' }, { status: 400 });
    const atRaw = typeof body?.at === 'string' ? Date.parse(body.at) : NaN;
    const at = Number.isFinite(atRaw) ? new Date(atRaw).toISOString() : new Date().toISOString();

    const db = createServerClient();
    const { data, error } = await db.from('lead_touches')
      .insert({ lead_ref: leadRef, kind, note, at, by_id: caller.athleteId })
      .select('id, lead_ref, kind, by_id, at, note')
      .single();
    if (error) {
      console.error('leads touch insert failed', error);
      return NextResponse.json({ error: 'Failed to record the touch' }, { status: 500 });
    }
    return NextResponse.json({ touch: data });
  } catch (err) {
    console.error('Failed to record a lead touch:', err);
    return NextResponse.json({ error: 'Failed to record the touch' }, { status: 500 });
  }
}
