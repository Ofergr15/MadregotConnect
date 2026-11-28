import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/** POST { momentId } — the caller read it (SELF ONLY: only their own receipt row; the first read wins). */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof b.momentId === 'string' && /^[0-9a-f-]{36}$/i.test(b.momentId) ? b.momentId : null;
  if (!id) return NextResponse.json({ error: 'momentId is required' }, { status: 400 });
  const { error } = await createServerClient().from('academy_week_moment_receipts')
    .update({ read_at: new Date().toISOString() }).eq('moment_id', id).eq('athlete_id', caller.athleteId).is('read_at', null);
  if (error && !/does not exist|schema cache/i.test(error.message || '')) return NextResponse.json({ error: 'Failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
