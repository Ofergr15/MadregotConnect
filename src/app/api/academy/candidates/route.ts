import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { STAGES, type CandidateEvent, type CandidateRow } from '@/lib/academy/funnel';

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
  return { email: row.email ?? null, phone: row.phone ?? null };
}

async function staffOnly(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!(caller.isSuperUser || caller.isStaff)) {
    return { denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }) };
  }
  return { caller };
}

export async function GET(request: Request) {
  try {
    const gate = await staffOnly(request);
    if (gate.denied) return gate.denied;

    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from('academy_candidates')
      .select(CANDIDATE_COLUMNS)
      .order('created_at', { ascending: true });

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

    return NextResponse.json({
      candidates: (rows || []).map(r => ({ ...toCandidate(r), ...contactOf(r) })),
      events: (eventRows || []).map(toEvent),
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
      // read is needed anyway, for the flag below.
      const { data: athlete, error: athleteError } = await supabase
        .from('athletes')
        .select('id, is_academy')
        .eq('id', athleteId)
        .maybeSingle();
      if (athleteError) return NextResponse.json({ error: 'Failed to read the athlete' }, { status: 500 });
      if (!athlete) return NextResponse.json({ error: 'No such athlete' }, { status: 404 });

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

      // An athlete joined to an academy candidate IS an academy trainee, and this is the only
      // place that fact gets recorded by staff. `/api/academy/register` already sets the same
      // flag for whoever arrives through the public door; the case here is the existing club
      // member who joined the academy afterwards, whose row predates the academy entirely.
      // Without the flag they are invisible to every academy screen — tests, bands, threads,
      // dispatch — and no screen anywhere can fix it.
      //
      // Reported rather than thrown: the link is the thing that was asked for and it worked.
      // A failed flag leaves a trainee missing from the academy screens, which is visible and
      // one tap from fixed; failing the whole request would leave the two rows unjoined, which
      // is the state nothing can recover from.
      let academyFlagged = Boolean(athlete.is_academy);
      if (!academyFlagged) {
        const { error: flagError } = await supabase
          .from('athletes')
          .update({ is_academy: true })
          .eq('id', athleteId);
        academyFlagged = !flagError;
      }

      return NextResponse.json({ ok: true, academyFlagged });
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
