import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { STAGES, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';
import { COACH_ID } from '@/lib/constants';
import { isStaffRole } from '@/lib/auth/self-or-staff';
import { canAdmitToAcademy, isAcademyManager } from '@/lib/academy/pairing-server';
import { acceptAction, inviteAction } from '@/lib/academy/admit-server';
import { clubMatchesFor, readRosterForMatching } from '@/lib/academy/link-server';
import { holdsAcademyCoachRole } from '@/lib/academy/coaches';
import { coachIdsByTrainee, hasTraineeCoachesTable } from '@/lib/academy/trainee-coaches';

export const dynamic = 'force-dynamic';

/**
 * The intake funnel.
 *
 *   GET    /api/academy/candidates   → every candidate and every recorded step
 *   POST   /api/academy/candidates   → open a row for somebody who made contact
 *   PATCH  /api/academy/candidates   → record a step, undo one, edit, archive, or link
 *
 * STAFF ONLY, all of it, and this is the strictest table in the academy: it holds strangers'
 * names, phone numbers and emails alongside a coach's private impressions of them. Nobody on
 * the funnel has an account yet, so there is no "self" case to allow — unlike every other
 * academy route, `athleteId` never grants access to anything here.
 *
 * ── Why the board is not computed here ───────────────────────────────────────────────
 *
 * This returns ROWS, and the client calls `buildFunnel` on them. That is deliberate: the
 * board's central number is "how many days has this person been waiting", which is relative
 * to the reader's own today. Computing it server-side would fix it to the server's clock and
 * an Israeli coach opening the board at 00:30 would read yesterday's day count. The module is
 * pure and takes `now` as an argument for exactly this reason.
 *
 * The cost is that the client gets every event for every candidate. At academy scale that is
 * a dozen live rows and nine events each; the alternative — an endpoint per card — would be
 * more round trips than rows.
 */

const CANDIDATE_COLUMNS =
  'id, name, email, phone, source, goal, athlete_id, archived_at, archived_reason, created_at';

const STAGE_KEYS = new Set<string>(STAGES.map(s => s.key));

/** Migration 110 is pasted in by hand, so every handler has to survive its absence. */
const NOT_SET_UP = { candidates: [], events: [], tableMissing: true };

function toCandidate(row: any): CandidateRow {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    goal: row.goal ?? null,
    source: row.source ?? null,
    athleteId: row.athlete_id ? String(row.athlete_id) : null,
    archivedAt: row.archived_at ?? null,
    archivedReason: row.archived_reason ?? null,
    createdAt: String(row.created_at || ''),
  };
}

function toEvent(row: any): CandidateEvent {
  return {
    candidateId: String(row.candidate_id),
    stage: String(row.stage || ''),
    occurredAt: String(row.occurred_at || ''),
    recordedBy: row.recorded_by ?? null,
    note: row.note ?? null,
  };
}

/**
 * The email and phone are handed back only to staff, and only here.
 *
 * They are not in `CandidateRow` — the pure funnel module has no use for them and a type that
 * carried them would invite them onto the board, where a column of strangers' phone numbers
 * is exactly the screenshot nobody should be able to take. The card asks for them explicitly.
 */
function contactOf(row: any) {
  return {
    email: row.email ?? null,
    phone: row.phone ?? null,
    invitedAt: row.invited_at ?? null,
    acceptedAt: row.accepted_at ?? null,
  };
}

/** Migration 126's columns. Read when present; the board works without them. */
const INVITE_COLUMNS = ', invited_at, accepted_at';

/**
 * Every mail about each card, newest first: the ones tagged with the card itself
 * (invite, form received, accepted), plus those to its linked athlete (an approval
 * from the approvals list). Empty, never an error, before 096 or 126.
 */
async function emailsByCandidate(supabase: any, rows: any[]) {
  const out: Record<string, Array<{ id: string; template: string; status: string; createdAt: string; error: string | null }>> = {};
  const ids = rows.map(r => String(r.id));
  if (!ids.length) return out;
  const byAthlete = new Map<string, string>();
  for (const r of rows) if (r.athlete_id) byAthlete.set(String(r.athlete_id), String(r.id));

  const cols = 'id, template, status, created_at, error_message, candidate_id, athlete_id';
  const seen = new Set<string>();
  const push = (row: any, candidateId: string | undefined) => {
    if (!candidateId || seen.has(row.id)) return;
    seen.add(row.id);
    (out[candidateId] ||= []).push({
      id: String(row.id),
      template: String(row.template || ''),
      status: String(row.status || ''),
      createdAt: String(row.created_at || ''),
      error: row.error_message ?? null,
    });
  };
  const tagged = await supabase.from('email_log').select(cols).in('candidate_id', ids).order('created_at', { ascending: false }).limit(500);
  if (!tagged.error) for (const row of tagged.data || []) push(row, String(row.candidate_id));
  if (byAthlete.size) {
    const linked = await supabase
      .from('email_log')
      .select(cols.replace(', candidate_id', ''))
      .in('athlete_id', [...byAthlete.keys()])
      .order('created_at', { ascending: false })
      .limit(500);
    if (!linked.error) for (const row of linked.data || []) push(row, byAthlete.get(String(row.athlete_id)));
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

// The funnel is the academy manager's (see canAdmitToAcademy): candidates' phone
// numbers, intake answers and call notes, before anyone is anybody's trainee.
async function staffOnly(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!isAcademyManager(caller)) {
    return { denied: NextResponse.json({ error: 'Academy manager access required' }, { status: 403 }) };
  }
  return { caller };
}

export async function GET(request: Request) {
  try {
    const gate = await staffOnly(request);
    if (gate.denied) return gate.denied;

    const supabase = createServerClient();
    let { data: rows, error }: { data: any[] | null; error: any } = await supabase
      .from('academy_candidates')
      .select(CANDIDATE_COLUMNS + INVITE_COLUMNS)
      .order('created_at', { ascending: true });
    if (error && isMissingColumn(error)) {
      ({ data: rows, error } = await supabase
        .from('academy_candidates')
        .select(CANDIDATE_COLUMNS)
        .order('created_at', { ascending: true }));
    }

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP);
      return NextResponse.json({ error: 'Failed to read the funnel' }, { status: 500 });
    }

    const { data: eventRows, error: eventError } = await supabase
      .from('academy_candidate_events')
      .select('candidate_id, stage, occurred_at, recorded_by, note')
      .order('occurred_at', { ascending: true });

    if (eventError) {
      if (isMissingTable(eventError)) return NextResponse.json(NOT_SET_UP);
      return NextResponse.json({ error: 'Failed to read the funnel' }, { status: 500 });
    }

    const caller = gate.caller!;
    const canAdmit = canAdmitToAcademy(caller);
    const emails = await emailsByCandidate(supabase, rows || []).catch(() => ({}));
    // A runner already in the club who came through the form: most often a Strava signup,
    // whose placeholder address the form could never recognise. Only a suggestion.
    const matches = await readRosterForMatching(supabase as any)
      .then(roster => clubMatchesFor((rows || []) as any[], roster))
      .catch(() => ({} as ReturnType<typeof clubMatchesFor>));
    // The accept sheet's coach picker ("שיבוץ מאמנים"). Only the manager picks; a
    // coach accepts for themselves, so they get just their own entry. The academy's
    // coaches only — the role, primary or extra (127) — because that is what the
    // accept itself requires; listing every staff account offered admins the
    // accept then refused, and missed a coach who holds the role as an extra one.
    // Each with their load, so the picker can show who has room.
    let coaches: Array<{ id: string; name: string; trainees?: number }> = [];
    let multiCoach: boolean | undefined;
    if (canAdmit) {
      let staffRes: any = await supabase.from('athletes').select('id, name, role, extra_roles, is_academy, academy_coach_id').eq('coach_id', COACH_ID);
      const hasExtra = !(staffRes.error && isMissingColumn(staffRes.error));
      if (!hasExtra) staffRes = await supabase.from('athletes').select('id, name, role').eq('coach_id', COACH_ID);
      const staff: any[] = staffRes.data || [];
      const isCoach = (a: any) => (hasExtra ? holdsAcademyCoachRole(a) : isStaffRole(a.role));
      const load = new Map<string, number>();
      try {
        const sets = await coachIdsByTrainee(supabase as any, undefined, staff.filter(a => a.is_academy).map(a => ({ id: a.id, academy_coach_id: a.academy_coach_id ?? null })));
        for (const ids of sets.values()) for (const c of ids) load.set(c, (load.get(c) ?? 0) + 1);
      } catch { /* the load is a hint */ }
      coaches = staff
        .filter(isCoach)
        .filter((a: any) => isAcademyManager(caller) || a.id === caller.athleteId)
        .map((a: any) => ({ id: String(a.id), name: String(a.name || ''), trainees: load.get(String(a.id)) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      multiCoach = await hasTraineeCoachesTable(supabase as any);
    }

    return NextResponse.json({
      candidates: (rows || []).map(r => ({
        ...toCandidate(r),
        ...contactOf(r),
        emails: (emails as any)[String((r as any).id)] || [],
        linkedFromForm: matches[String((r as any).id)]?.linkedFromForm ?? false,
        clubMatch: matches[String((r as any).id)]?.clubMatch ?? null,
      })),
      events: (eventRows || []).map(toEvent),
      me: { canAdmit, isManager: isAcademyManager(caller), athleteId: caller.athleteId ?? null },
      coaches,
      multiCoach,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read the funnel' }, { status: 500 });
  }
}

/**
 * Open a row for somebody who made contact.
 *
 *   { name, email?, phone?, source?, goal?, formFilled?: boolean }
 *
 * `formFilled` stamps the first step at creation, which is the difference between the two
 * doors: somebody who arrived through the registration form has already done step one and
 * belongs in the intro-call column, while an Instagram DM typed in by hand is genuinely
 * waiting for the form. Getting that wrong would park every form applicant in a column
 * nobody needs to act on.
 */
export async function POST(request: Request) {
  try {
    const gate = await staffOnly(request);
    if (gate.denied) return gate.denied;

    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    if (!name) return NextResponse.json({ error: 'A candidate needs a name' }, { status: 400 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_candidates')
      .insert({
        name,
        email: String(body?.email || '').trim().toLowerCase() || null,
        phone: String(body?.phone || '').trim() || null,
        source: String(body?.source || '').trim() || 'instagram',
        goal: String(body?.goal || '').trim() || null,
      })
      .select(CANDIDATE_COLUMNS)
      .single();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to add the candidate' }, { status: 500 });
    }

    if (body?.formFilled) {
      // Failure here is swallowed on purpose: the candidate row is the thing that had to be
      // created, and losing the first step leaves them one column to the left — visible, and
      // fixable with one tap — where a 500 would lose the person entirely.
      await supabase.from('academy_candidate_events').insert({
        candidate_id: data.id,
        stage: 'form',
        recorded_by: gate.caller!.email,
      });
    }

    return NextResponse.json({ candidate: { ...toCandidate(data), ...contactOf(data) } });
  } catch {
    return NextResponse.json({ error: 'Failed to add the candidate' }, { status: 500 });
  }
}

/**
 * Move somebody along, or take them off the board.
 *
 *   { id, action: 'step',    stage, occurredAt?, note? }
 *   { id, action: 'unstep',  stage }
 *   { id, action: 'edit',    name?, email?, phone?, goal? }
 *   { id, action: 'archive', reason? }
 *   { id, action: 'restore' }
 *   { id, action: 'link',    athleteId }
 *   { id, action: 'unlink' }
 *   { id, action: 'invite',  note?, send?, preview? }   → admit-server.ts
 *   { id, action: 'accept',  coachId?, preview? }       → admit-server.ts
 */
export async function PATCH(request: Request) {
  try {
    const gate = await staffOnly(request);
    if (gate.denied) return gate.denied;

    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    const action = String(body?.action || '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data: existing, error: readError } = await supabase
      .from('academy_candidates')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (readError) {
      if (isMissingTable(readError)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to read the candidate' }, { status: 500 });
    }
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const touch = { updated_at: new Date().toISOString() };

    if (action === 'invite' || action === 'accept') {
      // Narrower than the rest of the board: a club coach may keep the funnel's notes,
      // but writing to strangers and letting them in is the academy's own staff.
      if (!canAdmitToAcademy(gate.caller!)) {
        return NextResponse.json({ error: 'Only the academy manager or an academy coach can do this' }, { status: 403 });
      }
      return action === 'invite'
        ? inviteAction(id, gate.caller!, body)
        : acceptAction(id, gate.caller!, body);
    }

    if (action === 'step') {
      const stage = String(body?.stage || '');
      // The stage list is product and lives in the pure module; the table has no CHECK
      // constraint. So this is the one place an unknown key can be refused, and it must be —
      // the reader ignores keys it does not know, so a typo here would be a step that
      // silently never counts.
      if (!STAGE_KEYS.has(stage)) return NextResponse.json({ error: 'Unknown stage' }, { status: 400 });

      const occurredAt = String(body?.occurredAt || '').trim();
      const when = occurredAt && Number.isFinite(Date.parse(occurredAt))
        ? new Date(occurredAt).toISOString()
        : new Date().toISOString();

      const { error } = await supabase
        .from('academy_candidate_events')
        .upsert(
          {
            candidate_id: id,
            stage,
            occurred_at: when,
            recorded_by: gate.caller!.email,
            note: String(body?.note || '').trim() || null,
          },
          // The unique index is (candidate_id, stage). An upsert rather than an insert
          // because recording a step twice is a coach correcting the date or adding what was
          // said, not an error to shout about.
          { onConflict: 'candidate_id,stage' },
        );
      if (error) {
        if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP, { status: 503 });
        return NextResponse.json({ error: 'Failed to record the step' }, { status: 500 });
      }
      await supabase.from('academy_candidates').update(touch).eq('id', id);
      return NextResponse.json({ ok: true });
    }

    if (action === 'unstep') {
      const stage = String(body?.stage || '');
      if (!STAGE_KEYS.has(stage)) return NextResponse.json({ error: 'Unknown stage' }, { status: 400 });
      const { error } = await supabase
        .from('academy_candidate_events')
        .delete()
        .eq('candidate_id', id)
        .eq('stage', stage);
      if (error) return NextResponse.json({ error: 'Failed to undo the step' }, { status: 500 });
      await supabase.from('academy_candidates').update(touch).eq('id', id);
      return NextResponse.json({ ok: true });
    }

    if (action === 'edit') {
      const patch: Record<string, unknown> = { ...touch };
      if (body?.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) return NextResponse.json({ error: 'A candidate needs a name' }, { status: 400 });
        patch.name = name;
      }
      if (body?.email !== undefined) patch.email = String(body.email || '').trim().toLowerCase() || null;
      if (body?.phone !== undefined) patch.phone = String(body.phone || '').trim() || null;
      if (body?.goal !== undefined) patch.goal = String(body.goal || '').trim() || null;

      const { data, error } = await supabase
        .from('academy_candidates')
        .update(patch)
        .eq('id', id)
        .select(CANDIDATE_COLUMNS)
        .single();
      if (error) return NextResponse.json({ error: 'Failed to save the candidate' }, { status: 500 });
      return NextResponse.json({ candidate: { ...toCandidate(data), ...contactOf(data) } });
    }

    if (action === 'archive') {
      const { error } = await supabase
        .from('academy_candidates')
        .update({
          ...touch,
          archived_at: new Date().toISOString(),
          archived_reason: String(body?.reason || '').trim() || null,
        })
        .eq('id', id);
      if (error) return NextResponse.json({ error: 'Failed to archive the candidate' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'restore') {
      // Somebody who said no in March and came back in September. The steps they already did
      // are still theirs — which is the whole reason archiving is not deleting.
      const { error } = await supabase
        .from('academy_candidates')
        .update({ ...touch, archived_at: null, archived_reason: null })
        .eq('id', id);
      if (error) return NextResponse.json({ error: 'Failed to restore the candidate' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    /**
     * Join the candidate to the athlete they became.
     *
     * This is the seam between the two doors the same human arrives through: staff open the
     * candidate row, the person registers themselves at `/academy-register`, and nothing else
     * in the product connects the two. Steps 5-9 of the funnel — watch, test, analysis, band,
     * first plan — are all facts about an ATHLETE, so without this field none of them can ever
     * be derived from data; they can only be hand-stamped by somebody remembering to.
     *
     * It does NOT record the `signup` step. Linking is strong evidence that signing up
     * happened, and stamping it here would still be a second door into one stage — the failure
     * the tests below guard against, where the same candidate lands in different columns
     * depending on which screen recorded them. The card's `בוצע` button is the one door.
     */
    if (action === 'link') {
      const athleteId = String(body?.athleteId || '');
      if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

      // The athlete has to exist. The foreign key would catch it, but as a 500 — and this
      // read is needed anyway, for the form's answers below.
      const { data: athlete, error: athleteError } = await supabase
        .from('athletes')
        .select('id, academy_intake')
        .eq('id', athleteId)
        .maybeSingle();
      if (athleteError) return NextResponse.json({ error: 'Failed to read the athlete' }, { status: 500 });
      if (!athlete) return NextResponse.json({ error: 'No such athlete' }, { status: 404 });

      // What the card points at now. A form applicant's card points at the account the form
      // opened; when staff move it to the runner's real account, that one is the duplicate.
      let { data: card, error: cardError }: { data: any; error: any } = await supabase
        .from('academy_candidates')
        .select('id, athlete_id, intake')
        .eq('id', id)
        .maybeSingle();
      if (cardError && isMissingColumn(cardError)) {
        ({ data: card } = await supabase.from('academy_candidates').select('id, athlete_id').eq('id', id).maybeSingle());
      }
      const previousId = card?.athlete_id ? String(card.athlete_id) : null;
      let previous: any = null;
      if (previousId && previousId !== athleteId) {
        const { data } = await supabase
          .from('athletes')
          .select('id, approved, onboarding_status, academy_intake')
          .eq('id', previousId)
          .maybeSingle();
        previous = data ?? null;
      }

      const { error } = await supabase
        .from('academy_candidates')
        .update({ ...touch, athlete_id: athleteId })
        .eq('id', id);
      if (error) {
        // The partial unique index on `athlete_id`: this athlete already has a candidate row,
        // and forking somebody's history in two is worse than refusing the link.
        if (String((error as any).code) === '23505') {
          return NextResponse.json({ error: 'That athlete is already linked to a candidate' }, { status: 409 });
        }
        return NextResponse.json({ error: 'Failed to link the candidate' }, { status: 500 });
      }

      // The form's answers follow the person. Never over answers the account already has.
      const answers = card?.intake ?? previous?.academy_intake ?? null;
      if (answers && !athlete.academy_intake) {
        await supabase.from('athletes').update({ academy_intake: answers }).eq('id', athleteId);
      }

      // The account the form opened, when the card is moved off it: never signed in, never
      // approved, and now nobody's. Only THAT kind of row is removed here — never a runner.
      // Falls back to marking it removed when something still references it.
      let removedDuplicate = false;
      if (previous && previous.approved !== true && previous.onboarding_status === 'academy_pending') {
        const { error: deleteError } = await supabase.from('athletes').delete().eq('id', previousId);
        if (!deleteError) removedDuplicate = true;
        else {
          const { error: removeError } = await supabase.from('athletes').update({ status: 'removed' }).eq('id', previousId);
          removedDuplicate = !removeError;
        }
      }

      // Deliberately NOT `is_academy`. The flag opens the Academy tab and changes the watch's
      // pace targets, so a runner would feel a link made during the intro calls. Accept
      // (admit-server) sets it; until then linking only changes the card.
      return NextResponse.json({ ok: true, removedDuplicate });
    }

    /**
     * Take the link back.
     *
     * A mis-link is the most expensive mistake on this board: one stranger's injuries and the
     * coach's private `fit` verdict sitting on somebody else's account. The partial unique
     * index makes it unfixable without this — the right athlete cannot be linked while the
     * wrong one holds the row.
     *
     * It deliberately does NOT clear `is_academy`. Being an academy trainee is not undone by
     * correcting a clerical error, and clearing it would drop a real trainee out of every
     * academy screen as a side effect of fixing an unrelated mistake. The flag has its own
     * door, in the athlete's own settings.
     */
    if (action === 'unlink') {
      const { error } = await supabase
        .from('academy_candidates')
        .update({ ...touch, athlete_id: null })
        .eq('id', id);
      if (error) return NextResponse.json({ error: 'Failed to unlink the candidate' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Failed to update the candidate' }, { status: 500 });
  }
}
