import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { isStaffRole } from '@/lib/auth/self-or-staff';
import { loadPair, pairLookupError, requireAcademyManager, setPairCoaches } from '@/lib/academy/pairing-server';
import { holdsAcademyCoachRole } from '@/lib/academy/coaches';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/academy/coach — set, change, or clear a trainee's coaches.
 *
 * Body: `{ athleteId, coachIds: string[], reason? }` — the whole set, first = the
 * legacy `academy_coach_id` (migration 135: several coaches, all equal). The old
 * `{ athleteId, coachId | null }` still works and means `[coachId]` / `[]`.
 * Before 135 is pasted, a set of more than one is refused with 409 `no_schema`.
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
    const legacyCoach: string | null | undefined =
      rawCoach === null || rawCoach === '' ? null
        : typeof rawCoach === 'string' ? rawCoach.trim()
          : undefined;
    const coachIds: string[] | undefined = Array.isArray(body.coachIds)
      ? [...new Set((body.coachIds as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()))]
      : legacyCoach === undefined ? undefined : legacyCoach ? [legacyCoach] : [];
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 300)
      : null;

    if (!athleteId || coachIds === undefined) {
      return NextResponse.json(
        { error: 'athleteId and coachIds (or coachId) are required; pass [] or null to unpair' },
        { status: 400 },
      );
    }
    if (coachIds.includes(athleteId)) {
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
    const coachNames: string[] = [];
    for (const coachId of coachIds) {
      const { data: coach, error } = await supabase
        .from('athletes')
        .select('id, name, role, extra_roles')
        .eq('id', coachId)
        .eq('coach_id', COACH_ID)
        .maybeSingle();
      if (error || !coach) {
        return NextResponse.json({ error: 'No such coach in this club' }, { status: 404 });
      }
      // An academy coach only (2026-10-06): not every admin or club coach.
      if (!holdsAcademyCoachRole(coach)) {
        return NextResponse.json(
          { error: `${coach.name} is not an academy coach — add them as one first` },
          { status: 400 },
        );
      }
      coachNames.push(coach.name);
    }
    const coachId = coachIds[0] ?? null;
    const coachName = coachNames[0] ?? null;

    if (pair.academyCoachIds.length === coachIds.length
      && coachIds.every((c) => pair.academyCoachIds.includes(c))
      && pair.academyCoachId === coachId) {
      // Idempotent: re-picking the coaches a trainee already has is a no-op, not an
      // error, and must not write a second history row for one arrangement.
      return NextResponse.json({ athleteId, coachId, coachName, coachIds, coachNames, unchanged: true });
    }

    const result = await setPairCoaches(athleteId, coachIds, reason);
    if (!result.ok) {
      return result.reason === 'no_schema'
        ? NextResponse.json(
          { error: 'Several coaches per trainee need migration 135 — paste it first', code: 'no_schema' },
          { status: 409 },
        )
        : NextResponse.json({ error: 'Failed to assign the coach' }, { status: 500 });
    }

    return NextResponse.json({
      athleteId, coachId, coachName, coachIds, coachNames,
      added: result.added, removed: result.removed, unchanged: result.unchanged,
    });
  } catch (error: any) {
    console.error('Academy coach assign error:', error);
    return NextResponse.json({ error: error.message || 'Failed to assign the coach' }, { status: 500 });
  }
}
