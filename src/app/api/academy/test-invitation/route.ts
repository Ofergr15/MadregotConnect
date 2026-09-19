import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import type { TestInvitation } from '@/lib/academy/testInvite';

export const dynamic = 'force-dynamic';

/**
 * The test a trainee has been asked to run and has not run yet.
 *
 *   GET   /api/academy/test-invitation[?athleteId=…]  → the open invitation, or null
 *   POST  /api/academy/test-invitation               → staff: invite somebody to test
 *   PATCH /api/academy/test-invitation               → answer it, re-offer times, or withdraw it
 *
 * SELF OR STAFF, and the asymmetry between those two callers is the whole security surface of
 * this route. A trainee answers their own invitation; staff create, re-time and withdraw them.
 *
 * ── THE TRAINEE MAY ONLY CONFIRM A TIME THAT WAS OFFERED ─────────────────────────────────
 *
 * `academy_test_invitations.confirmed_slot` deliberately has no CHECK tying it to
 * `proposed_slots`, because the coach has to be able to enter a time agreed on the phone. That
 * freedom must NOT extend to the trainee, and the reason is not tidiness:
 *
 *   The reminders are computed from `confirmed_slot`. A trainee who can set an arbitrary slot
 *   can set it to next February, and both reminders — including the follow-up whose entire job
 *   is to catch the test being forgotten — move with it. The screen would still read
 *   "confirmed", the coach's board would still show a scheduled test, and the one mechanism
 *   built to notice the silence would be switched off by the person it was built for. Not out
 *   of malice; "let me put it off" is the most natural tap in the world.
 *
 * So a non-staff confirm is checked against the offered list, and against the clock.
 *
 * ── AND MAY NOT WITHDRAW IT ──────────────────────────────────────────────────────────────
 *
 * There is no trainee-facing cancel, on purpose. The honest version of "I cannot do this" is
 * `other` — ask for a different time, which reaches the coach and keeps the person in the
 * funnel. A cancel button would let a single tap turn an engaged candidate into a silent row,
 * and the academy would learn nothing from it. Staff cancel; the trainee negotiates.
 *
 * ── AND DOES NOT MOVE THE FUNNEL ─────────────────────────────────────────────────────────
 *
 * Confirming a time is not testing. Nothing here writes `academy_candidate_events`: the only
 * code path that moves a candidate between columns stays
 * `PATCH /api/academy/candidates { action: 'step' }`, as the funnel's route tests assert. Nor
 * does this route set `status='done'` — that belongs to whatever records the RESULT, because
 * done means a measurement exists (the table's own CHECK says so) and this route never sees one.
 */

const COLUMNS =
  'id, athlete_id, protocol, proposed_slots, confirmed_slot, confirmed_at, status, '
  + 'requested_note, test_id, created_at, updated_at';

/** The states an invitation is still live in. Matches the partial unique index in migration 112. */
const OPEN = ['proposed', 'confirmed', 'other'];

/** Migration 112 is pasted in by hand, so every handler has to survive its absence. */
const NOT_SET_UP = { invitation: null, tableMissing: true };

function readInvitation(row: Record<string, unknown>): TestInvitation {
  const slots = Array.isArray(row.proposed_slots) ? row.proposed_slots : [];
  return {
    id: String(row.id),
    athleteId: String(row.athlete_id),
    protocol: String(row.protocol || '30min'),
    proposedSlots: slots.filter((s): s is string => typeof s === 'string'),
    confirmedSlot: typeof row.confirmed_slot === 'string' ? row.confirmed_slot : null,
    status: String(row.status || 'proposed') as TestInvitation['status'],
    requestedNote: typeof row.requested_note === 'string' ? row.requested_note : null,
    testId: typeof row.test_id === 'string' ? row.test_id : null,
  };
}

/** An ISO instant, or null. A TIMESTAMPTZ column turns anything else into a 500. */
function instant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Two instants naming the same moment, however each was written. */
function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

/**
 * Which athlete this request is about, and whether the caller is allowed to act for them.
 *
 * A non-staff caller's athlete is ALWAYS their own session's, never the body's or the query
 * string's — the identity-in-a-query-string bug this codebase has already swept out once. A
 * mismatch is refused rather than silently redirected, because a client sending somebody
 * else's id is a client with a bug worth hearing about.
 */
function resolveTarget(
  caller: { isSuperUser: boolean; isStaff: boolean; athleteId: string | null },
  requested: string,
): { athleteId: string } | { error: NextResponse } {
  const isStaff = caller.isSuperUser || caller.isStaff;
  if (isStaff) {
    const id = requested || caller.athleteId || '';
    if (!id) return { error: NextResponse.json({ error: 'athleteId is required' }, { status: 400 }) };
    return { athleteId: id };
  }
  const own = caller.athleteId || '';
  if (!own) return { error: NextResponse.json({ error: 'No athlete on this account' }, { status: 403 }) };
  if (requested && requested !== own) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { athleteId: own };
}

/** The shape `resolveVerifiedCaller` hands back, narrowed to what this route reads. */
type Caller = { isSuperUser: boolean; isStaff: boolean; role?: string | null; athleteId: string | null };

/**
 * The athlete has to exist, and a non-manager coach may only act on their own trainee — the same
 * scoping every other academy staff route uses.
 *
 * Shared by every staff write here rather than living in `POST` alone, which is where it used to
 * live: `cancel` had no scoping at all, so any coach in the club could withdraw somebody else's
 * trainee's test. That is the kind of hole that only ever shows up once a second coach exists.
 */
async function refuseUnlessTheirTrainee(
  supabase: ReturnType<typeof createServerClient>,
  caller: Caller,
  athleteId: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('athletes')
    .select('id, academy_coach_id')
    .eq('id', athleteId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Failed to read the athlete' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'No such athlete' }, { status: 404 });

  const isManager = caller.isSuperUser || caller.role === 'admin';
  if (!isManager && data.academy_coach_id !== caller.athleteId) {
    return NextResponse.json({ error: 'Not your trainee' }, { status: 403 });
  }
  return null;
}

/**
 * The times to offer, as the column wants them.
 *
 * Past times are dropped rather than rejected — a coach building next week's invitation at
 * midnight should not get a 400 because one chip in the list has just expired — but an offer with
 * nothing future left in it is refused, because writing it would produce a screen whose every
 * chip is untappable and whose reminders can never fire.
 */
function offeredSlots(raw: unknown): string[] {
  const now = Date.now();
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  return list.map(instant).filter((s): s is string => s !== null && Date.parse(s) > now);
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const requested = new URL(request.url).searchParams.get('athleteId') || '';
    const target = resolveTarget(caller, requested);
    if ('error' in target) return target.error;

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select(COLUMNS)
      .eq('athlete_id', target.athleteId)
      .in('status', OPEN)
      // The unique index allows only one open row, so this is belt-and-braces ordering rather
      // than a real tie-break — but a 500 from `.single()` on a duplicate would take down the
      // trainee's whole weekly screen over a row nobody should have been able to write.
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP);
      return NextResponse.json({ error: 'Failed to read the invitation' }, { status: 500 });
    }

    return NextResponse.json({
      invitation: data ? readInvitation(data as unknown as Record<string, unknown>) : null,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read the invitation' }, { status: 500 });
  }
}

/**
 * Invite somebody to test.
 *
 *   { athleteId, protocol?, slots: string[] }
 *
 * STAFF ONLY. `slots` is ordered — the first is the time being asked for, the rest are the
 * alternatives offered with it — and past times are dropped rather than rejected: a coach
 * building next week's invitations at midnight should not get a 400 because one chip in the
 * list has just expired.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const athleteId = String(body?.athleteId || '');
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const slots = offeredSlots(body?.slots);
    if (slots.length === 0) {
      return NextResponse.json({ error: 'At least one future slot is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const refused = await refuseUnlessTheirTrainee(supabase, caller, athleteId);
    if (refused) return refused;

    const { data, error } = await supabase
      .from('academy_test_invitations')
      .insert({
        athlete_id: athleteId,
        protocol: String(body?.protocol || '30min'),
        proposed_slots: slots,
        status: 'proposed',
        created_by: caller.athleteId || null,
      })
      .select(COLUMNS)
      .single();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      // The partial unique index. Answered as a 409 with the reason, because "he already has
      // one open" is the useful reply — the coach's next move is to look at it, not to retry.
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'This athlete already has an open test invitation' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
    }

    return NextResponse.json({ invitation: readInvitation(data as unknown as Record<string, unknown>) });
  } catch {
    return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
  }
}

/**
 * Answer an invitation, or withdraw it.
 *
 *   { id, action: 'confirm', slot }   — self or staff
 *   { id, action: 'other', note? }    — self or staff
 *   { id, action: 'offer', slots }    — STAFF ONLY, see below
 *   { id, action: 'cancel' }          — STAFF ONLY, see the header
 *
 * ── WHY RE-OFFERING IS A PATCH AND NOT A SECOND POST ─────────────────────────────────────
 *
 * The commonest thing a coach does with an invitation is offer different times: the trainee asked
 * for another time, which is the entire point of `other`. `POST` cannot do that — migration 112's
 * partial unique index allows one open row per athlete, so a second create 409s — and closing the
 * old row to create a new one would throw away the note that says WHY the first times failed,
 * which is the one fact the new times should be chosen from.
 *
 * So `offer` replaces `proposed_slots` in place and puts the row back to `proposed`. It keeps
 * `requested_note` deliberately: until the trainee answers, "works shifts until the 20th" is still
 * true and still the reason the board should show for this invitation.
 *
 * Every action is scoped to the invitation's OWN athlete after reading the row, not to the
 * athleteId in the body: the id is the only thing the client sends that matters, and the row
 * behind it is the authority on whose invitation it is.
 */
export async function PATCH(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    const action = String(body?.action || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: row, error: readError } = await supabase
      .from('academy_test_invitations')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      if (isMissingTable(readError)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to read the invitation' }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const invite = readInvitation(row as unknown as Record<string, unknown>);
    const isStaff = caller.isSuperUser || caller.isStaff;
    if (!isStaff && invite.athleteId !== caller.athleteId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // A closed invitation is not answerable. Without this, the follow-up reminder's cancelled
    // row could be re-opened by a stale tab confirming a slot after the test was recorded.
    if (!OPEN.includes(invite.status)) {
      return NextResponse.json({ error: 'This invitation is already closed' }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    let patch: Record<string, unknown>;

    if (action === 'confirm') {
      const slot = instant(body?.slot);
      if (!slot) return NextResponse.json({ error: 'A valid slot is required' }, { status: 400 });

      if (!isStaff) {
        // See the header: a trainee who can name their own time can move the follow-up
        // reminder out of reach, which switches off the one mechanism that notices the test
        // never happened.
        if (!invite.proposedSlots.some(s => sameInstant(s, slot))) {
          return NextResponse.json({ error: 'Pick one of the offered times' }, { status: 400 });
        }
        if (Date.parse(slot) <= Date.now()) {
          return NextResponse.json({ error: 'That time has already passed' }, { status: 400 });
        }
      }

      patch = { status: 'confirmed', confirmed_slot: slot, confirmed_at: nowIso, requested_note: null };
    } else if (action === 'other') {
      // The note is the whole content of the message ("I work shifts until the 20th"), so an
      // empty one is allowed: "none of these work" is itself an answer worth having.
      const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
      patch = { status: 'other', confirmed_slot: null, confirmed_at: null, requested_note: note || null };
    } else if (action === 'offer') {
      if (!isStaff) {
        // A trainee offering themselves times is the confirm hole with extra steps: they would
        // offer next February and then legitimately confirm it.
        return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
      }
      const refused = await refuseUnlessTheirTrainee(supabase, caller, invite.athleteId);
      if (refused) return refused;

      const slots = offeredSlots(body?.slots);
      if (slots.length === 0) {
        return NextResponse.json({ error: 'At least one future slot is required' }, { status: 400 });
      }
      // `confirmed_slot` is cleared because the times it was chosen from no longer stand: leaving
      // it would keep a reminder armed for a slot that is no longer on offer, and the row would
      // read "confirmed for Thursday" while showing three new chips.
      patch = { status: 'proposed', proposed_slots: slots, confirmed_slot: null, confirmed_at: null };
    } else if (action === 'cancel') {
      if (!isStaff) {
        return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
      }
      const refused = await refuseUnlessTheirTrainee(supabase, caller, invite.athleteId);
      if (refused) return refused;
      patch = { status: 'cancelled' };
    } else {
      return NextResponse.json(
        { error: "action must be 'confirm', 'other', 'offer' or 'cancel'" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('academy_test_invitations')
      .update({ ...patch, updated_at: nowIso })
      .eq('id', id)
      .select(COLUMNS)
      .single();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to update the invitation' }, { status: 500 });
    }

    return NextResponse.json({ invitation: readInvitation(data as unknown as Record<string, unknown>) });
  } catch {
    return NextResponse.json({ error: 'Failed to update the invitation' }, { status: 500 });
  }
}
