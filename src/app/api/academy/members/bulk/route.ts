import { NextResponse } from 'next/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { parseBulk } from '@/lib/academy/manage';
import { runBulk } from '@/lib/academy/manage-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/members/bulk — one write for one trainee or many.
 *
 *   { athleteIds, action: 'coach',   coachIds[] | coachId | null, notify? }  replace the coaches, or unpair
 *   { athleteIds, action: 'addCoach', coachIds[] | coachId, notify? }  add coaches, keep the rest
 *   { athleteIds, action: 'removeCoach', coachId }               drop one coach, keep the rest
 *   { athleteIds, action: 'band',    bandId | null }            set the goal band
 *   { athleteIds, action: 'remove' }                            out of the academy, still in the club
 *   { athleteIds, action: 'add',     coachIds? | coachId?, bandId?, notify? } approved club members, straight in
 *   { athleteIds, action: 'restore', coachId?, notify? }        bring back, with the last coach by default
 *
 * Academy manager only. Every id is checked on its own — 'coach', 'band' and
 * 'remove' need a current academy member, 'add' and 'restore' an approved club
 * member who is not one — and the answer is per id. A coach change writes the
 * same history as PUT /api/academy/coach (writeCoachPair); a removal the same
 * as PUT /api/athletes (applyAcademyMembership).
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await requireAcademyManager(request);
    if (denied) return denied;
    const parsed = parseBulk(await request.json().catch(() => ({})));
    if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 });
    return await runBulk(parsed, caller);
  } catch (error) {
    console.error('Academy bulk error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
