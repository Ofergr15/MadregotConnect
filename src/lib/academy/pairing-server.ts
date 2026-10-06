import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveVerifiedCaller, type VerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { getStreamServerClient } from '@/lib/stream/server';
import { syncAcademyThreadCoaches } from './thread-server';
import {
  coachIdsOf, setTraineeCoaches, traineeIdsOfCoach, type SetCoachesResult,
} from './trainee-coaches';

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
type RoleCaller = { isSuperUser: boolean; role?: string | null; roles?: string[] };

export function isAcademyManager(caller: RoleCaller): boolean {
  // `academy_manager` (migration 127) is the manager without the rest of admin.
  return caller.isSuperUser || hasRole(caller, 'admin') || hasRole(caller, 'academy_manager');
}

/**
 * May this caller let somebody into the academy from the funnel — send the form
 * invite, accept them? The manager only (2026-10-06): the academy runs as a
 * hierarchy — admin names managers, a manager runs the funnel, names coaches and
 * pairs trainees, a coach runs the trainees they were given. Coaches used to pick
 * their own from the funnel.
 */
export function canAdmitToAcademy(caller: RoleCaller): boolean {
  return isAcademyManager(caller);
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
  /**
   * The FIRST of the trainee's coaches (the legacy `academy_coach_id`), or null when
   * they have none. Kept for the callers that only ever named one coach.
   */
  academyCoachId: string | null;
  /**
   * Every coach of this trainee since migration 135 — all equal, first = the legacy
   * one. `[]` = without a coach. Read through lib/academy/trainee-coaches.ts.
   */
  academyCoachIds: string[];
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
  const coachIds = await coachIdsOf(supabase, data.id, data.academy_coach_id || null);
  return {
    ok: true,
    pair: {
      athleteId: data.id,
      name: data.name,
      isAcademy: !!data.is_academy,
      academyCoachId: coachIds[0] ?? null,
      academyCoachIds: coachIds,
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

  // Any of their coaches: every coach of a shared trainee has the same access.
  const isOwnTrainee = !!caller.athleteId && lookup.pair.academyCoachIds.includes(caller.athleteId);
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
 * Replace a trainee's coaches — the one write behind PUT /api/academy/coach, the
 * bulk actions and the funnel's accept, so every door leaves the same trail.
 *
 * The DB side is `setTraineeCoaches` (legacy column first, then the link table,
 * then the history, which follows the first coach). This adds the conversation:
 * the shared thread gains the coaches who were added and loses the ones removed.
 * Best-effort — the pair is the source of truth and the thread re-syncs its
 * membership on every open anyway.
 */
export async function setPairCoaches(
  athleteId: string,
  coachIds: string[],
  reason: string | null,
): Promise<SetCoachesResult> {
  const supabase = createServerClient();
  const result = await setTraineeCoaches(supabase, athleteId, coachIds, { reason });
  if (result.ok && !result.unchanged && (result.added.length || result.removed.length)
    && process.env.STREAM_API_KEY && process.env.STREAM_API_SECRET) {
    try {
      await syncAcademyThreadCoaches(getStreamServerClient(), supabase, athleteId, result.removed);
    } catch (err) {
      console.error('Academy thread membership sync failed (the pair is saved):', err);
    }
  }
  return result;
}

/**
 * Write a trainee's ONE coach (or none) — the single-coach door, kept for the
 * callers that pair with one coach (the funnel's accept, "bring back"). The set
 * becomes `[coachId]`. Returns false only when the write failed.
 */
export async function writeCoachPair(
  athleteId: string,
  coachId: string | null,
  reason: string | null,
): Promise<boolean> {
  const result = await setPairCoaches(athleteId, coachId ? [coachId] : [], reason);
  return result.ok;
}

/**
 * Which trainees this caller may see in an academy-wide read: `null` for the
 * manager (all of them), otherwise the ids paired to the caller. The same line
 * /api/academy/members draws, for the routes that used to hand every coach the
 * whole academy — stats, compliance, results, plan inputs, workout feedback.
 *
 * `?scope=coach` narrows a manager to their own trainees, as on members; nothing
 * widens a coach. Before migration 077 there is no pairing, and a coach sees
 * nobody rather than everybody.
 */
export async function visibleTraineeIds(
  caller: RoleCaller & { athleteId: string | null },
  request?: Request,
): Promise<Set<string> | null> {
  const narrowed = request ? new URL(request.url).searchParams.get('scope') === 'coach' : false;
  if (isAcademyManager(caller) && !narrowed) return null;
  if (!caller.athleteId) return new Set();
  // Shared trainees included: a trainee with two coaches is in both their scopes.
  return new Set(await traineeIdsOfCoach(createServerClient(), caller.athleteId));
}

/**
 * May this caller read or write one trainee's academy record: themselves, the
 * manager, or ANY of the coaches they are paired with (all coaches are equal). Narrower than `mayActFor`, which
 * lets any staff account act for anyone — right for club data, wrong for a 1:1
 * academy where one coach's trainee is not another coach's business.
 */
export async function mayCoach(
  caller: RoleCaller & { athleteId: string | null; isStaff: boolean },
  athleteId: string,
): Promise<boolean> {
  if (caller.athleteId && caller.athleteId === athleteId) return true;
  if (isAcademyManager(caller)) return true;
  if (!caller.isStaff || !caller.athleteId) return false;
  const lookup = await loadPair(athleteId);
  return lookup.ok && lookup.pair.academyCoachIds.includes(caller.athleteId);
}
