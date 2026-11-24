import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, requirePackLeader } from '@/lib/auth/self-or-staff';
import { isAcademyManager } from '@/lib/academy/pairing-server';
import { isFeatureEnabled } from '@/lib/features/server';
import { notifyAthlete } from '@/lib/push';
import { israelToday } from '@/lib/utils';
import { packMembers, planPublishedAt } from '@/lib/packs/server';
import { eligibleFromPack, eligibleFromReceipts, nudgeCopy, parseNudgeBody } from '@/lib/academy/read-nudge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/academy/read-nudge — b24 UNR. Body: { athleteIds[], momentId } or { athleteIds[], packId }.
 * Answer: { sent: string[], already: string[], skipped: string[] }.
 *
 * WHO, from the JWT only (never a body field):
 * - momentId: the moment's author, or the academy manager — the same two who may read its receipts.
 * - packId:   that pack's leader, or staff (`requirePackLeader`).
 * TO WHOM: only people that screen lists as unread (lib/academy/read-nudge.ts); anyone else → `skipped`.
 * HOW OFTEN: once per person per Israel day, across every screen and sender — the read_nudges PRIMARY KEY is the
 * limit, claimed before the push, so a double press or two senders cannot push twice (`already`).
 * Flag `academy_read_nudge` (default off) for the caller → 404, so the route doesn't exist until enabled.
 * Delivery goes through notifyAthlete with kind `academy_read_nudge`: the recipient's own notification
 * preferences and the QA-actor suppression apply exactly as for any other push.
 */
export async function POST(request: Request) {
  try {
    const body = parseNudgeBody(await request.json().catch(() => null));
    if ('error' in body) return NextResponse.json({ error: body.error }, { status: 400 });
    const { context, athleteIds } = body;

    let caller;
    if (context.type === 'pack') {
      const r = await requirePackLeader(request, context.packId);
      if (r.denied) return r.denied;
      caller = r.caller;
    } else {
      const r = await resolveVerifiedCaller(request);
      if (r.denied) return r.denied;
      caller = r.caller;
    }
    if (!caller.athleteId) return NextResponse.json({ error: 'no athlete identity' }, { status: 403 });
    if (!(await isFeatureEnabled('academy_read_nudge', caller.athleteId).catch(() => false))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const db = createServerClient();
    let eligible: string[];
    if (context.type === 'moment') {
      const { data: m } = await db.from('academy_week_moments').select('author_id, sent_at').eq('id', context.momentId).maybeSingle();
      const row = m as { author_id?: string; sent_at?: string | null } | null;
      // Same answer as receipts for a moment you may not see: 404, not 403.
      if (!row?.author_id || (row.author_id !== caller.athleteId && !isAcademyManager(caller))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (!row.sent_at) return NextResponse.json({ error: 'not sent yet', code: 'not_sent' }, { status: 409 });
      const { data: rec } = await db.from('academy_week_moment_receipts').select('athlete_id, read_at')
        .eq('moment_id', context.momentId).in('athlete_id', athleteIds);
      eligible = eligibleFromReceipts(athleteIds, (rec || []) as Array<{ athlete_id: string; read_at: string | null }>);
    } else {
      const today = israelToday();
      const [members, publishedAt] = await Promise.all([packMembers(db, context.packId), planPublishedAt(db, today)]);
      eligible = eligibleFromPack(athleteIds, members, publishedAt);
    }
    const skipped = athleteIds.filter((id) => !eligible.includes(id));
    if (!eligible.length) return NextResponse.json({ sent: [], already: [], skipped });

    // Claim today's slot per person BEFORE pushing. A row that comes back is ours to send; a missing one was
    // already nudged today. ignoreDuplicates = ON CONFLICT DO NOTHING, and `select` returns only inserted rows.
    const day = israelToday();
    const contextId = context.type === 'moment' ? context.momentId : context.packId;
    const { data: claimed, error } = await db.from('read_nudges')
      .upsert(eligible.map((a) => ({ athlete_id: a, nudged_on: day, nudged_by: caller.athleteId, context: context.type, context_id: contextId })),
        { onConflict: 'athlete_id,nudged_on', ignoreDuplicates: true })
      .select('athlete_id');
    if (error) {
      if (/does not exist|schema cache/i.test(error.message || '')) {
        return NextResponse.json({ error: 'migration 219 not applied', code: 'migration_pending' }, { status: 503 });
      }
      throw new Error(error.message);
    }
    const sent = ((claimed || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id);
    const already = eligible.filter((id) => !sent.includes(id));

    const { data: me } = await db.from('athletes').select('name').eq('id', caller.athleteId).maybeSingle();
    const copy = nudgeCopy((me as { name?: string } | null)?.name, context.type);
    const url = context.type === 'moment' ? `/dashboard/academy?moment=${context.momentId}` : '/dashboard/plan';
    await Promise.all(sent.map((a) => notifyAthlete({
      athleteId: a, kind: 'academy_read_nudge', actorAthleteId: caller.athleteId,
      title: copy.title, body: copy.body, url, tag: `read-nudge-${contextId}`,
    }).catch(() => null)));

    return NextResponse.json({ sent, already, skipped });
  } catch (err: any) {
    console.error('POST /api/academy/read-nudge error:', err);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
