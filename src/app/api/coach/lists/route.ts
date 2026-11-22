import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff, requireStaffCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// The coach's own runner lists (ולנסיה, …), migration 186. Staff-only, both ways.
// Before the migration: GET answers `{ lists: [], available: false }`, writes 503.

// GET /api/coach/lists → { lists: [{ id, name, note, members: [athleteId] }], available }
export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  const db = createServerClient();
  const lists = await db.from('athlete_lists').select('id, name, note, created_at').order('created_at');
  if (lists.error) return NextResponse.json({ lists: [], available: false });
  // Embed hinted on the column, as every athletes embed from a second-FK table must be.
  const members = await db.from('athlete_list_members').select('list_id, athlete_id, athletes!athlete_id(name)');
  const rows = (members.error ? [] : members.data || []) as any[];
  return NextResponse.json({
    available: true,
    lists: (lists.data || []).map((l: any) => ({
      id: l.id, name: l.name, note: l.note ?? null,
      members: rows.filter((m) => m.list_id === l.id).map((m) => m.athlete_id),
    })),
  });
}

// POST /api/coach/lists { name, note? } → { list }
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60) return NextResponse.json({ error: 'name is required (≤60 chars)' }, { status: 400 });
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 120) || null : null;
  const db = createServerClient();
  const { data, error } = await db.from('athlete_lists')
    .insert({ name, note, created_by: caller.athleteId })
    .select('id, name, note')
    .single();
  if (error) return NextResponse.json({ error: 'migration_pending', details: error.message }, { status: 503 });
  return NextResponse.json({ list: data });
}
