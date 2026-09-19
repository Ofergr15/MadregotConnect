import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { israelToday } from '@/lib/utils';
import { settlementFor } from '@/lib/academy/settleInvitation';
import type { BoardRow } from '@/lib/academy/testBoard';

export const dynamic = 'force-dynamic';

/**
 * Every open test invitation the caller is allowed to see.
 *
 *   GET /api/academy/test-invitation/board
 *
 * STAFF ONLY, and scoped like every other academy staff route: a manager sees the roster, a
 * coach sees their own trainees. Training here is 1:1, so a coach's list is short and complete
 * — which is the property that makes "whose move is it" answerable at a glance.
 *
 * ── WHY THIS IS NOT `GET /api/academy/test-invitation?all=1` ─────────────────────────────
 *
 * The singular route is self-or-staff and returns ONE invitation: the trainee's own. Bolting a
 * roster-wide list onto it would put a staff-only, name-carrying payload behind the same handler
 * a trainee calls on every page load, one boolean away from being served to them. Separate
 * route, separate 403.
 *
 * The ordering, the grouping and every label live in `lib/academy/testBoard.ts`, and the state
 * is derived on the CLIENT from these raw rows — not here. The board's states differ by nothing
 * but the clock, so a state computed at fetch time would be a fact that silently goes stale in
 * an open tab, and `today` would keep saying `today` tomorrow morning.
 */

const COLUMNS =
  'id, athlete_id, protocol, proposed_slots, confirmed_slot, status, requested_note, '
  + 'test_id, created_at, updated_at';

/** The states an invitation is still live in. Matches the partial unique index in migration 112. */
const OPEN = ['proposed', 'confirmed', 'other'];

/**
 * Migration 112 is pasted in by hand, so an absent table has to read as "not set up".
 *
 * `invitable` is empty here and not the whole roster: with no table there is nowhere to write an
 * invitation, so offering the button would be offering a 503.
 */
const NOT_SET_UP = { rows: [], invitable: [], tableMissing: true };

/** A test a trainee submitted and nobody has approved. */
interface PendingSubmission { id: string; protocol: string; date: string; submittedAt: string }

/**
 * The unapproved submissions for these athletes, one per athlete.
 *
 * Why one and not all: the partial unique index allows a single open invitation per athlete, so
 * at most one submission can be answering it. Where somebody has submitted twice — a correction,
 * which migration 105's unique index turns into an upsert, or two different protocols — the
 * latest is the one the coach is about to look at.
 *
 * Degrades to "none" on purpose. Pre-108 there is no `status` column and therefore no pending row
 * anywhere in the table, and a board that fails to load because of an approval column it only
 * wanted for a label would be trading the whole screen for a nicety.
 */
async function pendingSubmissions(
  supabase: ReturnType<typeof createServerClient>,
  athleteIds: string[],
): Promise<Map<string, PendingSubmission>> {
  const out = new Map<string, PendingSubmission>();
  const { data, error } = await supabase
    .from('academy_tests')
    .select('id, athlete_id, protocol, test_date, submitted_at, status')
    .in('athlete_id', athleteIds)
    .eq('status', 'pending')
    .order('test_date', { ascending: true });
  if (error || !data) {
    if (error && !isMissingTable(error) && !isMissingColumn(error)) {
      console.error('board pending submissions read failed:', error);
    }
    return out;
  }
  for (const r of data) {
    const raw = r as unknown as Record<string, unknown>;
    const date = String(raw.test_date ?? '').slice(0, 10);
    if (!date) continue;
    // Ascending, so the last write wins and the map holds the most recent submission.
    out.set(String(raw.athlete_id), {
      id: String(raw.id),
      protocol: String(raw.protocol || '30min'),
      date,
      // Falling back to the test's own day: pre-108 rows have no `submitted_at`, and the field's
      // job here is "there is a result waiting", not a precise timestamp.
      submittedAt: typeof raw.submitted_at === 'string' ? raw.submitted_at : date,
    });
  }
  return out;
}

/**
 * Whether that submission is the answer to THIS invitation, via the write path's own rule.
 *
 * `settlementFor` with `approved: false` returns `hold` for exactly the submissions that would
 * settle the invitation once approved — right protocol, not predating it. Calling it here rather
 * than re-implementing the comparison is the point: the board says "waiting for approval" about
 * precisely the rows that approval will close.
 */
function submittedAtFor(
  submission: PendingSubmission | undefined,
  invite: { protocol: string; createdDay: string },
): string | null {
  if (!submission) return null;
  const settlement = settlementFor(
    { id: 'board', protocol: invite.protocol, createdDay: invite.createdDay, reminderBeforeId: null, reminderAfterId: null },
    { id: submission.id, protocol: submission.protocol, date: submission.date, approved: false },
  );
  return settlement.kind === 'hold' ? submission.submittedAt : null;
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const isManager = caller.isSuperUser || caller.role === 'admin';
    const supabase = createServerClient();

    // `name` is the only athlete field read. A board needs to say who, and nothing else here
    // is the coach's business on this screen — the member sheet is where a person is opened.
    const { data: people, error: rosterError } = await supabase
      .from('athletes')
      .select('id, name, is_academy, academy_coach_id')
      .eq('coach_id', COACH_ID);
    if (rosterError) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });

    const names = new Map<string, string>();
    for (const person of people || []) {
      if (!person.is_academy) continue;
      if (!isManager && person.academy_coach_id !== caller.athleteId) continue;
      names.set(String(person.id), String(person.name || person.id));
    }

    // A coach with no trainees yet is not an error and must not read the invitations table at
    // all: `.in('athlete_id', [])` is a filter that matches nothing, but asking is still a
    // query whose only possible answer is one this caller could not be shown.
    if (names.size === 0) return NextResponse.json({ rows: [], invitable: [] });

    const { data, error } = await supabase
      .from('academy_test_invitations')
      .select(COLUMNS)
      .in('athlete_id', [...names.keys()])
      .in('status', OPEN)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP);
      return NextResponse.json({ error: 'Failed to read the invitations' }, { status: 500 });
    }

    const submissions = await pendingSubmissions(supabase, [...names.keys()]);

    const rows: BoardRow[] = (data || []).map(r => {
      const raw = r as unknown as Record<string, unknown>;
      const slots = Array.isArray(raw.proposed_slots) ? raw.proposed_slots : [];
      return {
        name: names.get(String(raw.athlete_id)) || String(raw.athlete_id),
        createdAt: String(raw.created_at ?? ''),
        // Missing `updated_at` falls back to `created_at` rather than to now: a row that has
        // never been touched has been waiting since it was sent, and dating it "now" would
        // reset every silence counter on the board on every refresh.
        updatedAt: String(raw.updated_at ?? raw.created_at ?? ''),
        // The submission this invitation is waiting on approval for, if there is one. Decided by
        // the write path's own rule so the board and the settle cannot disagree about which
        // result answers which appointment.
        submittedAt: submittedAtFor(submissions.get(String(raw.athlete_id)), {
          protocol: String(raw.protocol || '30min'),
          createdDay: israelToday(new Date(String(raw.created_at ?? ''))),
        }),
        invite: {
          id: String(raw.id),
          athleteId: String(raw.athlete_id),
          protocol: String(raw.protocol || '30min'),
          proposedSlots: slots.filter((s): s is string => typeof s === 'string'),
          confirmedSlot: typeof raw.confirmed_slot === 'string' ? raw.confirmed_slot : null,
          status: String(raw.status || 'proposed') as BoardRow['invite']['status'],
          requestedNote: typeof raw.requested_note === 'string' ? raw.requested_note : null,
          testId: typeof raw.test_id === 'string' ? raw.test_id : null,
        },
      };
    });

    // Who could be invited: every trainee in scope with no open invitation.
    //
    // Derived here rather than fetched by the sheet, because it is the same two reads the board
    // has already done and the subtraction is the whole answer. Sending the full roster and
    // letting the client filter would be the same data over the wire; sending it as a separate
    // request would let the two halves disagree — a name in both lists means a 409 on tap.
    const open = new Set(rows.map(r => r.invite.athleteId));
    const invitable = [...names.entries()]
      .filter(([id]) => !open.has(id))
      .map(([athleteId, name]) => ({ athleteId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

    return NextResponse.json({ rows, invitable });
  } catch {
    return NextResponse.json({ error: 'Failed to read the invitations' }, { status: 500 });
  }
}
