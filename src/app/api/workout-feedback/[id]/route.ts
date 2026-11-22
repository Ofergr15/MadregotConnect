import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// DELETE /api/workout-feedback/[id] → SOFT withdraw by its owner (migration 191).
// The row stays — staff still see it, marked "בוטל". 503 before 191.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const db = createServerClient();
  const { data: row } = await db.from('workout_feedback').select('id, athlete_id').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!caller.athleteId || row.athlete_id !== caller.athleteId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const now = new Date().toISOString();
  const { error } = await db.from('workout_feedback').update({ withdrawn_at: now }).eq('id', id);
  if (error) {
    if ((error as { code?: string }).code === '42703') return NextResponse.json({ error: 'migration_pending', details: 'migration 191 not applied' }, { status: 503 });
    return NextResponse.json({ error: 'Failed to withdraw', details: error.message }, { status: 500 });
  }
  return NextResponse.json({ id, withdrawnAt: now });
}
