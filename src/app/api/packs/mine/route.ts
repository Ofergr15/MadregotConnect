import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { loadPack, packMembers } from '@/lib/packs/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/packs/mine — the caller's own pack (role 'member') and every pack they lead
 * (role 'leader', migration 215). Names and counts only.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ packs: [] });
    const db = createServerClient();
    const [{ data: me }, { data: led }] = await Promise.all([
      db.from('athletes').select('group_id').eq('id', caller.athleteId).maybeSingle(),
      db.from('pack_leaders').select('pack_id').eq('athlete_id', caller.athleteId),
    ]);
    const roles = new Map<string, 'leader' | 'member'>();
    if (me?.group_id) roles.set(me.group_id, 'member');
    for (const r of (led || []) as Array<{ pack_id: string }>) roles.set(r.pack_id, 'leader');
    const packs = (await Promise.all([...roles].map(async ([id, role]) => {
      const pack = await loadPack(db, id);
      if (!pack) return null;
      const members = await packMembers(db, id);
      return { id, name: pack.name, groupIndex: pack.groupIndex, role, memberCount: members.length };
    }))).filter(Boolean);
    return NextResponse.json({ packs });
  } catch (err: any) {
    console.error('GET /api/packs/mine error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
