import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { readResults, readSuggestions } from '@/lib/champions/server';
import { CHAMP_DISTANCES, board, type ChampScope, type ChampSex } from '@/lib/champions/table';

export const dynamic = 'force-dynamic';

/**
 * GET /api/club/champions — אלופי המדרגות for any member: per distance × men / women /
 * all × this year / all time, the top 10 and the caller's own place. Official race
 * times only (race_results, staff-approved).
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const db = createServerClient();
  const { ready, rows } = await readResults(db);
  const today = israelToday();
  const boards: Record<string, ReturnType<typeof board>> = {};
  for (const distance of CHAMP_DISTANCES)
    for (const sex of ['men', 'women', 'all'] as ChampSex[])
      for (const scope of ['year', 'all'] as ChampScope[])
        boards[`${distance}:${sex}:${scope}`] = board(rows, { distance, sex, scope, today, viewerId: caller.athleteId });
  const canManage = caller.isStaff || caller.isSuperUser;
  // Staff see how many race-day runs wait for them — every result goes through approval.
  let pending = 0;
  if (canManage && ready) {
    const { data: used } = await db.from('race_results').select('activity_id').not('activity_id', 'is', null);
    pending = (await readSuggestions(db, new Set(((used || []) as { activity_id: string }[]).map((r) => r.activity_id))).catch(() => [])).length;
  }
  return NextResponse.json({ ready, today, boards, canManage, pending });
}
