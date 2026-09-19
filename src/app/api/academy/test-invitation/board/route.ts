import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingTable } from '@/lib/supabase/schema-drift';
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

/** Migration 112 is pasted in by hand, so an absent table has to read as "not set up". */
const NOT_SET_UP = { rows: [], tableMissing: true };

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
    if (names.size === 0) return NextResponse.json({ rows: [] });

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

    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ error: 'Failed to read the invitations' }, { status: 500 });
  }
}
