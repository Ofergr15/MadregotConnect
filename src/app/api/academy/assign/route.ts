import { NextResponse } from 'next/server';
import { requireAcademyManager, setPairCoaches } from '@/lib/academy/pairing-server';
import { createServerClient } from '@/lib/supabase/server';
import { coachIdsByTrainee } from '@/lib/academy/trainee-coaches';
import { capacityOf, checkAssignment } from '@/lib/academy/capacity';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/assign {athleteId, coachIds[], force?} — MANAGER ONLY (a coach never
 * changes assignment). Capacity is checked server-side; over cap → 409 with the coaches
 * that would overflow unless `force` (the sheet's confirm).
 */
export async function POST(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : '';
    const coachIds: string[] = Array.isArray(body?.coachIds) ? body.coachIds.filter((x: unknown) => typeof x === 'string') : [];
    if (!athleteId || !coachIds.length) return NextResponse.json({ error: 'athleteId and coachIds required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: academy } = await supabase.from('athletes').select('id, availability').eq('is_academy', true);
    const ids = (academy || []).map((a: any) => a.id as string);
    const paused = new Set((academy || []).filter((a: any) => a.availability === 'paused').map((a: any) => a.id));
    const links = await coachIdsByTrainee(supabase, ids);
    const active: Record<string, number> = {};
    for (const [tid, cs] of links) if (!paused.has(tid)) for (const c of cs) active[c] = (active[c] || 0) + 1;
    let caps: any[] = [];
    const capRes = await supabase.from('athletes').select('id, academy_capacity').in('id', coachIds);
    if (!capRes.error) caps = capRes.data || [];
    const loads = Object.fromEntries(coachIds.map((id) => [id, { active: active[id] || 0, capacity: capacityOf(caps.find((c) => c.id === id)?.academy_capacity) }]));
    const check = checkAssignment(coachIds, links.get(athleteId) || [], loads, body?.force === true);
    if (!check.ok) return NextResponse.json({ error: 'over_capacity', ...check }, { status: 409 });

    const result = await setPairCoaches(athleteId, coachIds, typeof body?.reason === 'string' ? body.reason : null);
    if (!result.ok) return NextResponse.json({ error: 'assign failed' }, { status: 500 });
    return NextResponse.json({ ...check, ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'assign failed' }, { status: 500 });
  }
}
