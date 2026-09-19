import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import type { RoundOutcome } from '@/lib/academy/testRound';

export const dynamic = 'force-dynamic';

/**
 * Invite a whole round of trainees to test.
 *
 *   POST /api/academy/test-round  { athleteIds: string[], protocol?, slots: string[] }
 *
 * STAFF ONLY, and scoped like every other academy staff route: a manager may round the roster, a
 * coach only their own trainees.
 *
 * Section 5's `שבץ סבב`. Who belongs in a round is decided in `lib/academy/testRound.ts` and
 * confirmed on screen; this route writes what the coach confirmed.
 *
 * ── IT TAKES A LIST, IT DOES NOT COMPUTE ONE ──────────────────────────────────────────────
 *
 * The obvious design is "the server works out who is overdue and invites them", and it is wrong
 * for one reason: the coach confirmed a NAMED LIST on a screen. A server that recomputes the
 * cohort can invite somebody the coach never saw — a trainee whose test crossed the staleness line
 * an hour ago, a row added between the preview and the tap — and the one thing a bulk action must
 * never do is surprise the person who pressed it. So the body carries ids, and the route's job is
 * to refuse the ones it must and write the rest.
 *
 * ── ONE INSERT PER ATHLETE, ON PURPOSE ────────────────────────────────────────────────────
 *
 * A single multi-row insert is atomic, which sounds like the safer choice and is the wrong one
 * here: one trainee who got invited by hand a minute ago trips migration 112's unique index and
 * takes the other seventeen invitations down with them. A round is N independent appointments and
 * nothing about it is transactional — so each row goes in on its own and the response reports,
 * per athlete, what happened.
 *
 * Which makes the recovery story "run it again": whoever succeeded now has an open invitation, and
 * `buildRound` skips them. There is no round id anywhere and none is needed.
 *
 * ── NO NOTIFICATION IS SENT FROM HERE ─────────────────────────────────────────────────────
 *
 * This route creates rows. The two reminders per invitation are dispatch's job (migration 112 has
 * the columns, `settle-invitation-server.ts` already cancels them), and a bulk action that also
 * sent N pushes would make the blast radius of a mis-tap N phone notifications instead of N rows a
 * coach can cancel.
 */

/**
 * The most athletes one round may carry.
 *
 * Not a product rule — a guard. The academy's roster is tens of people, so a body with hundreds of
 * ids is a broken client or somebody probing, and refusing it costs nothing. A real round that
 * ever hits this ceiling means the club has grown past this screen, which is a good problem and a
 * conversation rather than a silent truncation.
 */
const MAX_ROUND = 60;

/** An ISO instant in the future, or null. A TIMESTAMPTZ column turns anything else into a 500. */
function futureInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t) || t <= Date.now()) return null;
  return new Date(t).toISOString();
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const requested: unknown[] = Array.isArray(body?.athleteIds) ? body.athleteIds : [];
    // Deduped, because the same id twice would be one invitation and one confusing 409 about a
    // duplicate the caller created themselves.
    const athleteIds: string[] = [
      ...new Set(requested.map(id => String(id || '')).filter(id => id !== '')),
    ];
    if (athleteIds.length === 0) {
      return NextResponse.json({ error: 'athleteIds is required' }, { status: 400 });
    }
    if (athleteIds.length > MAX_ROUND) {
      return NextResponse.json({ error: `A round may not exceed ${MAX_ROUND} athletes` }, { status: 400 });
    }

    const rawSlots: unknown[] = Array.isArray(body?.slots) ? body.slots : [];
    const slots = rawSlots.map(futureInstant).filter((s): s is string => s !== null);
    if (slots.length === 0) {
      return NextResponse.json({ error: 'At least one future slot is required' }, { status: 400 });
    }

    const protocol = String(body?.protocol || '30min');
    const supabase = createServerClient();

    // One roster read for the whole round, rather than the single-invitation route's read per
    // athlete: same scoping rule, and a round of twenty must not be twenty round trips to learn
    // something one query answers.
    const { data: people, error: rosterError } = await supabase
      .from('athletes')
      .select('id, is_academy, academy_coach_id')
      .eq('coach_id', COACH_ID);
    if (rosterError) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });

    const isManager = caller.isSuperUser || caller.role === 'admin';
    const allowed = new Set(
      (people || [])
        .filter(p => p.is_academy && (isManager || p.academy_coach_id === caller.athleteId))
        .map(p => String(p.id)),
    );

    // The WHOLE round is refused if any id is out of scope, rather than quietly dropping it.
    //
    // This is the one condition here that is not a race: a coach's client cannot arrive at
    // somebody else's trainee by accident, so the honest answer is that the request is wrong and
    // nothing was written. Dropping the stranger and inviting the rest would write N-1
    // invitations off a request nobody can account for.
    const strangers = athleteIds.filter(id => !allowed.has(id));
    if (strangers.length > 0) {
      return NextResponse.json(
        { error: 'The round includes athletes who are not yours', count: strangers.length },
        { status: 403 },
      );
    }

    const outcome: RoundOutcome = { invited: [], failed: [] };
    for (const athleteId of athleteIds) {
      const { error } = await supabase
        .from('academy_test_invitations')
        .insert({
          athlete_id: athleteId,
          protocol,
          proposed_slots: slots,
          status: 'proposed',
          created_by: caller.athleteId || null,
        });

      if (!error) {
        outcome.invited.push(athleteId);
        continue;
      }
      // Nothing can be written at all, so stop rather than collect the same failure twenty times.
      if (isMissingTable(error)) {
        return NextResponse.json({ error: 'The invitations table is not set up yet' }, { status: 503 });
      }
      // The partial unique index: somebody was invited between the preview and this write. Benign,
      // and reported by name so the coach sees the round covered one fewer person than it offered.
      const reason = (error as { code?: string }).code === '23505' ? 'already_invited' : 'write_failed';
      if (reason === 'write_failed') console.error('test round insert failed:', error);
      outcome.failed.push({ athleteId, reason });
    }

    return NextResponse.json(outcome);
  } catch {
    return NextResponse.json({ error: 'Failed to create the round' }, { status: 500 });
  }
}
