import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/records/privacy { leaderboardOptOut?, squadCompare? } — the caller's
 * OWN two switches (Settings → Privacy · tables). The athlete comes from the JWT,
 * never the body, so this cannot opt anyone else out or in. 409 before 195.
 */
export async function PATCH(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, boolean> = {};
    if (typeof body.leaderboardOptOut === 'boolean') patch.leaderboard_opt_out = body.leaderboardOptOut;
    if (typeof body.squadCompare === 'boolean') patch.squad_compare = body.squadCompare;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to change' }, { status: 400 });
    const { error } = await createServerClient().from('athletes').update(patch).eq('id', caller.athleteId);
    if (error) {
      if (isMissingColumn(error)) return NextResponse.json({ error: 'migration 195 pending' }, { status: 409 });
      console.error('[api/records/privacy]', error);
      return NextResponse.json({ error: 'update failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('records/privacy error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
