import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';

// The gates the 1:1 pairing endpoints share.
//
// `requireStaff` isn't enough here, and that distinction is the whole point of
// this slice: in a 1:1 academy "staff" splits into the manager, who decides who
// coaches whom, and the coaches, who run the trainees they were given. A coach
// reassigning their own trainee to somebody else is a management decision, and a
// coach editing a *different* coach's schedule is not their business at all.

/**
 * The academy's manager, as opposed to one of its coaches.
 *
 * Deliberately narrower than `isStaff`: a club `coach` and an `academy_coach`
 * are both staff, and neither runs the academy. Kept as a function of the role
 * the session already carries, so no extra lookup.
 */
export function isAcademyManager(caller: Pick<VerifiedCaller, 'isSuperUser' | 'role'>): boolean {
  return caller.isSuperUser || caller.role === 'admin';
}

/**
 * May this caller let somebody into the academy from the funnel — send the form
 * invite, accept them? The manager, and the academy's own coaches, who pick the
 * trainees they will run. A club `coach` is staff but not academy staff.
 */
export function canAdmitToAcademy(caller: Pick<VerifiedCaller, 'isSuperUser' | 'role'>): boolean {
  return isAcademyManager(caller) || caller.role === 'academy_coach';
}

export async function requireAcademyManager(
  request: Request,
): Promise<{ denied: Response | null; caller: VerifiedCaller }> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!isAcademyManager(caller)) {
    return {
      denied: NextResponse.json({ error: 'Academy manager access required' }, { status: 403 }),
      caller,
    };
  }
  return { denied: null, caller };
}

export interface AcademyPair {
  athleteId: string;
  name: string;
  isAcademy: boolean;
  /** The dedicated coach in force right now, or null when unpaired. */
  academyCoachId: string | null;
  /** The goal band (דבוקה) they're assigned to, or null. */
  academyBandId: string | null;
  /** Their own pace override in sec/km, or null to follow the band. */
  academyPaceOffsetSec: number | null;
}

export type PairLookup =
  | { ok: true; pair: AcademyPair }
  // `no_schema` is migration 077 not being applied yet, which is a different
  // answer from "no such trainee" and has to stay distinguishable — one is a
  // deployment step, the other a bad request.
  | { ok: false; reason: 'not_found' | 'no_schema' };

export async function loadPair(athleteId: string): Promise<PairLookup> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, is_academy, academy_coach_id, academy_band_id, academy_pace_offset_sec')
    .eq('id', athleteId)
    // Scoped to this club, so an id from elsewhere can't be paired into it.
    .eq('coach_id', COACH_ID)
    .maybeSingle();

  if (error) return { ok: false, reason: 'no_schema' };
  if (!data) return { ok: false, reason: 'not_found' };
  return {
    ok: true,
    pair: {
      athleteId: data.id,
      name: data.name,
      isAcademy: !!data.is_academy,
      academyCoachId: data.academy_coach_id || null,
      academyBandId: data.academy_band_id || null,
      // Not `|| null`: a stored 0 is a real decision ("runs exactly at band
      // pace") and must not collapse into "follows the band".
      academyPaceOffsetSec: typeof data.academy_pace_offset_sec === 'number'
        ? data.academy_pace_offset_sec
        : null,
    },
  };
}

/** Turn a failed lookup into the response the routes should return for it. */
export function pairLookupError(reason: 'not_found' | 'no_schema'): Response {
  return reason === 'no_schema'
    ? NextResponse.json(
      { error: 'Academy pairing is not available yet — migration 077 has not been applied.' },
      { status: 409 },
    )
    : NextResponse.json({ error: 'No such academy athlete' }, { status: 404 });
}

/**
 * May this caller make a coaching decision about this trainee?
 *
 * The manager, or the trainee's own dedicated coach — nobody else, which is why
 * this reads the pair rather than trusting a role. Returns the pair too, since
 * every caller needs it next anyway.
 *
 * The line this draws: setting a trainee's pace override is coaching (their own
 * coach knows what they can run), while assigning their goal band is enrolment
 * and stays manager-only via `requireAcademyManager`.
 */
export async function requireTraineeAccess(
  request: Request,
  athleteId: string,
): Promise<{ denied: Response | null; caller: VerifiedCaller; pair: AcademyPair | null }> {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller, pair: null };
  if (!caller.isSuperUser && !caller.isStaff) {
    return {
      denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }),
      caller,
      pair: null,
    };
  }

  const lookup = await loadPair(athleteId);
  if (!lookup.ok) return { denied: pairLookupError(lookup.reason), caller, pair: null };

  const isOwnTrainee = !!caller.athleteId && lookup.pair.academyCoachId === caller.athleteId;
  if (!isAcademyManager(caller) && !isOwnTrainee) {
    return {
      denied: NextResponse.json({ error: 'Not your trainee' }, { status: 403 }),
      caller,
      pair: lookup.pair,
    };
  }
  return { denied: null, caller, pair: lookup.pair };
}

/**
 * Write a trainee's dedicated coach: the column first, then the audit trail.
 *
 * Shared by PUT /api/academy/coach and the funnel's accept, so both doors leave the
 * same history. The order is the one documented on the coach route: the column is
 * what every read scopes on, and a failed history row is logged, not fatal.
 * Returns false only when the column write failed.
 */
export async function writeCoachPair(
  athleteId: string,
  coachId: string | null,
  reason: string | null,
): Promise<boolean> {
  const supabase = createServerClient();
  const today = israelToday();

  const { error: pairErr } = await supabase
    .from('athletes')
    .update({ academy_coach_id: coachId })
    .eq('id', athleteId)
    .eq('coach_id', COACH_ID);
  if (pairErr) {
    console.error('Academy coach assign error:', pairErr);
    return false;
  }

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
  return true;
}
