import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { israelToday } from '@/lib/utils';
import { isStaffRole } from '@/lib/auth/self-or-staff';
import { loadPair, pairLookupError, requireAcademyManager } from '@/lib/academy/pairing-server';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/academy/coach — assign, change, or clear a trainee's dedicated coach.
 *
 * Body: `{ athleteId, coachId | null, reason? }`.
 *
 * The single write that makes the academy's 1:1 structure real. Manager-only: a
 * coach may run their trainees but not decide who they are.
 *
 * Two things move together, and the order is deliberate:
 *
 *   1. `athletes.academy_coach_id` — the column every read scopes on, so it goes
 *      first. If anything after it fails the pair is still correct.
 *   2. `academy_coach_history` — closes the open row and opens the next. Logged
 *      rather than fatal: a gap in the audit trail is invisible and fixable,
 *      whereas failing the request after step 1 would leave the caller believing
 *      the assignment didn't happen when it did.
 *
 * Nothing else follows the trainee. The academy is coached online, so a handover
 * moves no booking and frees no hour — and what the trainee is training for (their
 * goal band, and any pace override) belongs to them, not to whoever coaches them,
 * so it survives the change untouched. An earlier draft also moved a standing
 * weekly appointment here; that was modelling something the academy does not do.
 */
export async function PUT(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
    // `null` is a real, meaningful value here — "unpair this trainee" — so it has
    // to be told apart from a caller who simply omitted the field.
    const rawCoach = body.coachId;
    const coachId: string | null | undefined =
      rawCoach === null || rawCoach === '' ? null
        : typeof rawCoach === 'string' ? rawCoach.trim()
          : undefined;
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 300)
      : null;

    if (!athleteId || coachId === undefined) {
      return NextResponse.json(
        { error: 'athleteId and coachId are required; pass coachId: null to unpair' },
        { status: 400 },
      );
    }
    if (coachId && coachId === athleteId) {
      return NextResponse.json({ error: 'A trainee cannot be their own coach' }, { status: 400 });
    }

    const lookup = await loadPair(athleteId);
    if (!lookup.ok) return pairLookupError(lookup.reason);
    const pair = lookup.pair;
    if (!pair.isAcademy) {
      return NextResponse.json(
        { error: 'That athlete is not in the academy — add them to it first' },
        { status: 409 },
      );
    }

    const supabase = createServerClient();

    // The coach must be a staff account in this club. Checked here rather than
    // trusted from the picker: the picker is built from the same list, but this
    // endpoint is reachable without it.
    let coachName: string | null = null;
    if (coachId) {
      const { data: coach, error } = await supabase
        .from('athletes')
        .select('id, name, role')
        .eq('id', coachId)
        .eq('coach_id', COACH_ID)
        .maybeSingle();
      if (error || !coach) {
        return NextResponse.json({ error: 'No such coach in this club' }, { status: 404 });
      }
      if (!isStaffRole(coach.role)) {
        return NextResponse.json(
          { error: `${coach.name} is not a staff account — set their role to academy_coach first` },
          { status: 400 },
        );
      }
      coachName = coach.name;
    }

    if (pair.academyCoachId === coachId) {
      // Idempotent: re-picking the coach a trainee already has is a no-op, not an
      // error, and must not write a second history row for one arrangement.
      return NextResponse.json({ athleteId, coachId, coachName, unchanged: true });
    }

    const today = israelToday();

    // 1. The pair itself.
    const { error: pairErr } = await supabase
      .from('athletes')
      .update({ academy_coach_id: coachId })
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID);
    if (pairErr) {
      console.error('Academy coach assign error:', pairErr);
      return NextResponse.json({ error: 'Failed to assign the coach' }, { status: 500 });
    }

    // 2. The audit trail.
    const closed = await supabase
      .from('academy_coach_history')
      .update({ ended_on: today })
      .eq('athlete_id', athleteId)
      .is('ended_on', null);
    if (closed.error) console.error('Academy coach history close failed:', closed.error);
    if (coachId) {
      const opened = await supabase
        .from('academy_coach_history')
        .insert({ athlete_id: athleteId, coach_id: coachId, started_on: today, reason });
      if (opened.error) console.error('Academy coach history open failed:', opened.error);
    }

    return NextResponse.json({ athleteId, coachId, coachName, unchanged: false });
  } catch (error: any) {
    console.error('Academy coach assign error:', error);
    return NextResponse.json({ error: error.message || 'Failed to assign the coach' }, { status: 500 });
  }
}
