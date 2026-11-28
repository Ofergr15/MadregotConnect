import { NextResponse, after } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { afterPackMove, previewWatchEffect } from '@/lib/groups/pack-move';
import { MIGRATION_326, MIGRATION_326_TEXT, isMissingMoveFunction, readMoveBody, summariseMove, type MoveRpcResult } from '@/lib/groups/pack-move-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/pack-move  { athleteId, toGroupId: packId | null, dryRun?: boolean, reason?: string }
 *
 * A coach moves one runner to another pack, from today (task 152). Staff only, never while
 * viewing as someone. Always answers with the effect summary — what changes on the watch
 * (lib/groups/pack-move.ts previewWatchEffect), whether a Saturday change of the member's
 * own is cancelled, and that the runner is told. `dryRun: true` stops there: nothing written.
 *
 * The move itself is one transaction (move_athlete_group, migration 326): group_id, the pack
 * history row and the audit row together or not at all. Without the function: 409, never a
 * half move. The watch check and the push run after the response, as PUT /api/athletes does.
 */
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'read-only while viewing as' }, { status: 403 });
  const body = readMoveBody(await request.json().catch(() => null));
  if ('error' in body) return NextResponse.json({ error: body.error }, { status: 400 });

  const db = createServerClient();
  try {
    const [{ data: athlete, error: aErr }, { data: groups, error: gErr }] = await Promise.all([
      db.from('athletes').select('id, name, status, group_id, pending_group_id, pending_group_from').eq('id', body.athleteId).eq('coach_id', COACH_ID).maybeSingle(),
      db.from('groups').select('id, name').eq('coach_id', COACH_ID),
    ]);
    if (aErr || gErr) throw aErr ?? gErr;
    if (!athlete) return NextResponse.json({ error: 'Athlete not in this club' }, { status: 404 });
    if (athlete.status === 'removed') return NextResponse.json({ error: 'Athlete was removed from the club' }, { status: 409 });
    const packs = (groups ?? []) as Array<{ id: string; name: string | null }>;
    if (body.toGroupId && !packs.some((g) => g.id === body.toGroupId)) return NextResponse.json({ error: 'Unknown pack' }, { status: 400 });
    const fromGroupId = (athlete.group_id as string | null) ?? null;
    if (fromGroupId === body.toGroupId) return NextResponse.json({ error: 'Already in this pack' }, { status: 409 });

    const fromDate = israelToday();
    const watch = await previewWatchEffect(db, { athleteId: body.athleteId, fromGroupId, toGroupId: body.toGroupId, fromDate });
    const summary = summariseMove({
      packs, fromGroupId, toGroupId: body.toGroupId, fromDate, watch,
      pending: athlete.pending_group_id ? { groupId: athlete.pending_group_id as string, from: (athlete.pending_group_from as string | null) ?? null } : null,
    });
    if (body.dryRun) return NextResponse.json({ dryRun: true, moved: false, ...summary });

    const { data, error } = await db.rpc('move_athlete_group', {
      p_athlete_id: body.athleteId, p_to_group_id: body.toGroupId, p_coach_id: COACH_ID, p_from_date: fromDate,
      p_by_athlete_id: caller.athleteId, p_by_email: caller.email || null, p_reason: body.reason,
    });
    if (isMissingMoveFunction(error)) return NextResponse.json({ error: MIGRATION_326, message: MIGRATION_326_TEXT }, { status: 409 });
    if (error) throw error;
    const result = data as MoveRpcResult | null;
    if (!result || result.status === 'not_found') return NextResponse.json({ error: 'Athlete not in this club' }, { status: 404 });
    // Somebody else moved them between the read and the lock: nothing written, say so.
    if (result.status === 'unchanged') return NextResponse.json({ error: 'Already in this pack' }, { status: 409 });

    const move = {
      athleteId: body.athleteId, fromGroupId: result.from_group_id ?? null, toGroupId: body.toGroupId, fromDate,
      by: 'coach' as const, byAthleteId: caller.athleteId, historyWritten: true,
    };
    after(() => afterPackMove(db, move));
    return NextResponse.json({ dryRun: false, moved: true, moveId: result.move_id ?? null, ...summary });
  } catch (err) {
    console.error('[api/admin/pack-move]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
