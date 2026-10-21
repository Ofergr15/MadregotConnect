import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { isProtectedEmail } from '@/lib/constants';
import { purgeAthlete, softRemove } from '@/lib/admin/purge-athlete';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/people/delete { athleteId, mode: 'soft' | 'full', confirmName? }
 *   soft — out of the club, nothing pulled any more, history kept (reversible).
 *   full — every row about them, the athlete row and the login. Irreversible, so the
 *          caller must send the person's name exactly as the confirmation.
 * Admin / super user only. Never an admin, a protected account, or yourself.
 */
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { athleteId?: string; mode?: string; confirmName?: string };
  if (!b.athleteId || (b.mode !== 'soft' && b.mode !== 'full')) return NextResponse.json({ error: 'athleteId and mode required' }, { status: 400 });
  const db = createServerClient();
  const { data: a } = await db.from('athletes').select('id, name, email, role, is_super_user, strava_athlete_id').eq('id', b.athleteId).maybeSingle();
  const row = a as { id: string; name: string | null; email: string | null; role: string | null; is_super_user: boolean | null; strava_athlete_id: number | null } | null;
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (row.role === 'admin' || row.is_super_user || isProtectedEmail(row.email)) return NextResponse.json({ error: 'protected' }, { status: 400 });
  if (caller.athleteId === row.id) return NextResponse.json({ error: 'yourself' }, { status: 400 });

  if (b.mode === 'soft') {
    const r = await softRemove(db, row.id);
    console.log(`[people/delete] ${caller.email} soft-removed ${row.id} (${row.name})`);
    return r.ok ? NextResponse.json({ ok: true, mode: 'soft' }) : NextResponse.json({ error: r.error }, { status: 500 });
  }
  if ((b.confirmName || '').trim() !== (row.name || '').trim()) return NextResponse.json({ error: 'confirm name' }, { status: 400 });
  const r = await purgeAthlete(db, row);
  console.log(`[people/delete] ${caller.email} PURGED ${row.id} (${row.name}):`, JSON.stringify({ removed: r.removed, failed: r.failed, auth: r.authUsers }));
  return r.ok
    ? NextResponse.json({ ok: true, mode: 'full', removed: r.removed, failed: r.failed, authUsers: r.authUsers })
    : NextResponse.json({ error: r.error, removed: r.removed, failed: r.failed }, { status: 500 });
}
