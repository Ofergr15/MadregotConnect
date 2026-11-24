import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requirePackLeader } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { editableUntil, isEditable, parseMarks } from '@/lib/packs/attendance';
import { attendanceRows, loadPack, packMembers, packSession } from '@/lib/packs/server';
import { forLeader } from '@/lib/packs/leader-safe';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function respond(db: ReturnType<typeof createServerClient>, packId: string, date: string, groupIndex: number) {
  const [members, session] = await Promise.all([packMembers(db, packId), packSession(db, date, groupIndex)]);
  const rows = await attendanceRows(db, packId, date, members, session);
  return {
    session: session ? { date: session.date, title: session.title, place: session.place } : null,
    editableUntil: editableUntil(date),
    rows,
  };
}

/**
 * GET /api/packs/:id/attendance?date=YYYY-MM-DD — the pack's register for one session.
 * A member with an activity within ±90 min of the session start is `present` from the watch.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { denied } = await requirePackLeader(request, id);
    if (denied) return denied;
    const date = new URL(request.url).searchParams.get('date') || israelToday();
    if (!ISO.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    const db = createServerClient();
    const pack = await loadPack(db, id);
    if (!pack) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(forLeader(await respond(db, id, date, pack.groupIndex)));
  } catch (err: any) {
    console.error('GET /api/packs/[id]/attendance error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

/**
 * POST /api/packs/:id/attendance { date, marks: [{ athleteId, status }] } — the leader's marks
 * (source 'leader', which beats the watch). Refused with 409 after `editableUntil` (12:00 Israel
 * the day after) and for a future date; staff are held to the same window.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { denied, caller } = await requirePackLeader(request, id);
    if (denied) return denied;
    if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const date = String(body?.date || '');
    if (!ISO.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    if (date > israelToday()) return NextResponse.json({ error: 'future session', code: 'future' }, { status: 409 });
    if (!isEditable(date)) {
      return NextResponse.json({ error: 'locked', code: 'locked', editableUntil: editableUntil(date) }, { status: 409 });
    }
    const db = createServerClient();
    const pack = await loadPack(db, id);
    if (!pack) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const members = await packMembers(db, id);
    const marks = parseMarks(body?.marks, new Set(members.map((m) => m.athleteId)));
    if (!marks) return NextResponse.json({ error: 'marks must be [{ athleteId (a pack member), status }]' }, { status: 400 });
    if (marks.length) {
      const now = new Date().toISOString();
      const { error } = await db.from('pack_attendance').upsert(
        marks.map((m) => ({
          pack_id: id, session_date: date, athlete_id: m.athleteId, status: m.status,
          source: 'leader', marked_by: caller.athleteId, marked_at: now,
        })),
        { onConflict: 'pack_id,session_date,athlete_id' },
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(forLeader(await respond(db, id, date, pack.groupIndex)));
  } catch (err: any) {
    console.error('POST /api/packs/[id]/attendance error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
