import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { MIN_PACE_SEC_PER_KM, MAX_PACE_SEC_PER_KM } from '@/lib/academy/repace';
import { analyzeTest, draftSummary, recommendBand } from '@/lib/academy/testAnalysis';
import { thresholdPaceSec } from '@/lib/academy/tests';
import type { AcademyBand } from '@/lib/academy/bands';

export const dynamic = 'force-dynamic';

/**
 * The test analysis — funnel step 8.
 *
 *   GET  /api/academy/test-analysis?testId=x   → the draft, and the saved decision if there is one
 *   POST /api/academy/test-analysis            → save the draft, or approve it
 *
 * STAFF ONLY, both ways, and scoped like every other academy staff route: a manager may analyse
 * anyone in the academy, a coach only their own trainees. Deliberately not readable by the
 * trainee: what they receive is the summary, sent as a message, not a table of thresholds with a
 * band recommendation and an unapproved draft in it.
 *
 * ── THE GET COMPUTES, IT DOES NOT REMEMBER ────────────────────────────────────────────────
 *
 * Every number in the response is derived from the test on this request, even when a saved
 * analysis exists. That is what makes the screen honest about the difference migration 113 is
 * built around: `derived` is what the formula says today and `approved` is what the coach signed,
 * and the coach has to be able to see both. Returning only the stored row would hide a
 * coefficient change; returning only the fresh computation would silently discard an edit.
 *
 * ── APPROVING IS THE ONLY WRITE THAT LEAVES THIS TABLE ────────────────────────────────────
 *
 * `status: 'approved'` with a band also sets `athletes.academy_band_id`, because that column is
 * what the plan composer reads and an approval that did not move it would be a signature with no
 * effect. Saving a draft touches nothing else. No notification is sent from here either — the
 * summary reaching the trainee is a message, and messages are their own slice.
 */

/** The columns of the analysis row, mapped once so nothing downstream sees snake_case. */
const ANALYSIS_COLUMNS =
  'id, test_id, athlete_id, derived, approved, recommended_band_id, band_id, summary, status, '
  + 'author_id, approved_by, approved_at, created_at, updated_at';

/**
 * The delivery columns, added by migration 114 and therefore optional.
 *
 * Kept separate so a screen deployed before the paste still works: selecting a column PostgREST
 * has never heard of fails the WHOLE select, which would take the analysis screen down over a
 * timestamp. Every read here goes through `selectAnalysis`, which retries without them.
 */
const DELIVERY_COLUMNS = 'sent_at, sent_by, sent_summary';

/** One analysis row, with delivery if the database has it yet. */
async function selectAnalysis(
  supabase: ReturnType<typeof createServerClient>,
  testId: string,
): Promise<{ row: Record<string, unknown> | null; tableMissing: boolean; deliveryMissing: boolean }> {
  const full = await supabase
    .from('academy_test_analyses')
    .select(`${ANALYSIS_COLUMNS}, ${DELIVERY_COLUMNS}`)
    .eq('test_id', testId)
    .maybeSingle();
  if (!full.error) {
    return { row: (full.data || null) as Record<string, unknown> | null, tableMissing: false, deliveryMissing: false };
  }
  if (isMissingTable(full.error)) return { row: null, tableMissing: true, deliveryMissing: false };
  if (!isMissingColumn(full.error)) return { row: null, tableMissing: false, deliveryMissing: false };

  const base = await supabase
    .from('academy_test_analyses')
    .select(ANALYSIS_COLUMNS)
    .eq('test_id', testId)
    .maybeSingle();
  return {
    row: (base.data || null) as Record<string, unknown> | null,
    tableMissing: !!base.error && isMissingTable(base.error),
    deliveryMissing: true,
  };
}

/** The numbers a coach is allowed to hand back. Anything else in the body is ignored. */
const EDITABLE_PACES = ['thresholdPaceSec', 'easyPaceSec', 'intervalPaceSec'] as const;

/**
 * A pace a human could run, or null.
 *
 * The bounds are `repace.ts`'s own, which exist because these numbers become a pace-zone alert on
 * a watch: 1:00/km would be accepted by Garmin and beeped at the runner for the whole rep. A
 * coach editing 4:45 to 4:35 is the point of the field; a coach editing it to 0:45 is a typo, and
 * refusing it here is cheaper than a plan written against it.
 */
function editedPace(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < MIN_PACE_SEC_PER_KM || rounded > MAX_PACE_SEC_PER_KM) return null;
  return rounded;
}

/** A heart rate the athlete could have. Same reasoning, mirroring migration 105's own CHECK. */
function editedHr(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 80 || rounded > 230) return null;
  return rounded;
}

/**
 * What the coach approved, filtered to the fields that mean something.
 *
 * A whitelist and not a pass-through of the request body. This JSONB is read back by the plan
 * composer, so anything that gets in here becomes something a later reader has to tolerate — and
 * an unvalidated blob is also how a client bug writes `thresholdPaceSec: "4:45"` into the column
 * every workout is priced from.
 */
function sanitizeApproved(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  const body = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of EDITABLE_PACES) {
    const pace = editedPace(body[key]);
    if (pace !== null) out[key] = pace;
  }
  const hr = editedHr(body.avgHrBpm);
  if (hr !== null) out.avgHrBpm = hr;
  return out;
}

function toBand(row: Record<string, unknown>): AcademyBand {
  return {
    id: String(row.id),
    bandNumber: Number(row.band_number),
    name: String(row.name || ''),
    goal: (row.goal as string) ?? null,
    paceProfile: (row.pace_profile as AcademyBand['paceProfile']) || {},
  };
}

/** The test, its athlete, and whether this caller may touch it. */
async function loadTest(
  supabase: ReturnType<typeof createServerClient>,
  testId: string,
  callerAthleteId: string | null,
  isManager: boolean,
) {
  const { data: test, error } = await supabase
    .from('academy_tests')
    .select('id, athlete_id, test_date, protocol, duration_sec, distance_m, avg_hr, excluded_reason')
    .eq('id', testId)
    .maybeSingle();
  if (error || !test) return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, is_academy, academy_coach_id, academy_band_id')
    .eq('id', (test as Record<string, unknown>).athlete_id as string)
    .eq('coach_id', COACH_ID)
    .maybeSingle();
  if (!athlete?.is_academy) return { denied: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (!isManager && athlete.academy_coach_id !== callerAthleteId) {
    return { denied: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { test: test as Record<string, unknown>, athlete: athlete as Record<string, unknown> };
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const testId = new URL(request.url).searchParams.get('testId') || '';
    if (!testId) return NextResponse.json({ error: 'testId is required' }, { status: 400 });

    const supabase = createServerClient();
    const isManager = caller.isSuperUser || caller.role === 'admin';
    const found = await loadTest(supabase, testId, caller.athleteId, isManager);
    if (found.denied) return found.denied;
    const { test, athlete } = found;

    const measurement = {
      protocol: String(test.protocol || '30min'),
      durationSec: Number(test.duration_sec),
      distanceM: Number(test.distance_m),
      avgHr: test.avg_hr === null || test.avg_hr === undefined ? null : Number(test.avg_hr),
    };
    const derived = analyzeTest(measurement);

    // The previous usable test of the SAME protocol, for the one comparison the summary makes.
    // Same-protocol because a 2000m and a 30-minute effort produce different paces at identical
    // fitness, so across them "12 seconds faster" is a sentence about the protocol.
    const { data: earlier } = await supabase
      .from('academy_tests')
      .select('duration_sec, distance_m, test_date')
      .eq('athlete_id', String(test.athlete_id))
      .eq('protocol', measurement.protocol)
      .is('excluded_reason', null)
      .lt('test_date', String(test.test_date))
      .order('test_date', { ascending: false })
      .limit(1);
    const previous = earlier?.[0]
      ? thresholdPaceSec({
          durationSec: Number(earlier[0].duration_sec),
          distanceM: Number(earlier[0].distance_m),
        })
      : null;

    const { data: bandRows } = await supabase
      .from('academy_bands')
      .select('id, band_number, name, goal, pace_profile')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    const bands = (bandRows || []).map(r => toBand(r as Record<string, unknown>));
    const recommendation = recommendBand(derived?.thresholdPaceSec ?? null, bands);

    // A saved decision, when there is one. Pre-113 there is no table, and that is a state the
    // screen must be able to describe rather than a 500 — every migration here is pasted by hand.
    const { row, tableMissing, deliveryMissing } = await selectAnalysis(supabase, testId);

    return NextResponse.json({
      test: {
        id: String(test.id),
        athleteId: String(test.athlete_id),
        name: String(athlete.name || ''),
        date: String(test.test_date),
        ...measurement,
        excludedReason: (test.excluded_reason as string) ?? null,
      },
      currentBandId: (athlete.academy_band_id as string) ?? null,
      derived,
      // The draft text, always freshly written and never stored until a coach saves it. Its whole
      // job is to be edited; a saved draft is the edit.
      draftSummary: derived ? draftSummary(measurement, derived, previous ? { paceSec: previous } : null) : '',
      previousPaceSec: previous,
      bands,
      recommendation: {
        bandId: recommendation.band?.id ?? null,
        bandNumber: recommendation.band?.bandNumber ?? null,
        reason: recommendation.reason,
        gapSec: recommendation.gapSec,
      },
      analysis: row && {
        id: String(row.id),
        derived: row.derived,
        approved: row.approved,
        bandId: (row.band_id as string) ?? null,
        recommendedBandId: (row.recommended_band_id as string) ?? null,
        summary: (row.summary as string) ?? null,
        status: String(row.status),
        approvedAt: (row.approved_at as string) ?? null,
        sentAt: (row.sent_at as string) ?? null,
        /**
         * What the trainee actually read.
         *
         * Returned beside `summary` and not merged into it, so the screen can say "he has an
         * earlier version of this" after the coach fixes a sentence. A timestamp alone would show
         * "sent" above text nobody has seen.
         */
        sentSummary: (row.sent_summary as string) ?? null,
      },
      tableMissing,
      // Migration 114 is not in yet, so the screen must not claim anything about delivery.
      deliveryMissing,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read the analysis' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const testId = String(body?.testId || '');
    if (!testId) return NextResponse.json({ error: 'testId is required' }, { status: 400 });
    const approving = body?.status === 'approved';

    const supabase = createServerClient();
    const isManager = caller.isSuperUser || caller.role === 'admin';
    const found = await loadTest(supabase, testId, caller.athleteId, isManager);
    if (found.denied) return found.denied;
    const { test, athlete } = found;

    const measurement = {
      protocol: String(test.protocol || '30min'),
      durationSec: Number(test.duration_sec),
      distanceM: Number(test.distance_m),
      avgHr: test.avg_hr === null || test.avg_hr === undefined ? null : Number(test.avg_hr),
    };
    const derived = analyzeTest(measurement);
    if (!derived) {
      return NextResponse.json({ error: 'This test cannot be analysed' }, { status: 400 });
    }

    // What the coach signed: the computed set, with their edits laid over it.
    //
    // A MERGE rather than either/or, for two reasons. The common case — "the draft is right,
    // approve it" — sends no numbers at all and must still store a complete set. And a client that
    // sends only the one field the coach touched must not blank the other three; an approved
    // analysis holding a threshold and nothing else is a record the plan composer cannot use.
    // A value that fails validation therefore falls back to the measurement rather than vanishing.
    const approved: Record<string, number> = {
      thresholdPaceSec: derived.thresholdPaceSec,
      easyPaceSec: derived.easyPaceSec,
      intervalPaceSec: derived.intervalPaceSec,
      ...(derived.avgHrBpm !== null ? { avgHrBpm: derived.avgHrBpm } : {}),
      ...sanitizeApproved(body?.approved),
    };

    // A sent analysis cannot go back to being a draft.
    //
    // Migration 114's own CHECK says so (`sent_at IS NULL OR status = 'approved'`), so without
    // this the downgrade would surface as a 500. But the reason is not the constraint: the summary
    // is already in the trainee's thread and cannot be unsent, and a screen that let the coach
    // return it to draft would show him "not yet sent" about a message somebody has read. Editing
    // the numbers or the text is still allowed — that is a resend, not a retraction.
    if (!approving) {
      const existing = await selectAnalysis(supabase, testId);
      if (existing.row?.sent_at) {
        return NextResponse.json(
          { error: 'This analysis has already been sent to the trainee', code: 'already_sent' },
          { status: 409 },
        );
      }
    }

    const bandId = body?.bandId === null || body?.bandId === undefined ? null : String(body.bandId);
    if (bandId) {
      // A band that does not exist would be stored by the FK check as a 500 from a UUID cast, and
      // an inactive one is a band nobody trains in.
      const { data: band } = await supabase
        .from('academy_bands').select('id, active').eq('id', bandId).maybeSingle();
      if (!band?.active) return NextResponse.json({ error: 'Unknown band' }, { status: 400 });
    }

    const { data: bandRows } = await supabase
      .from('academy_bands')
      .select('id, band_number, name, goal, pace_profile')
      .eq('active', true);
    const recommendation = recommendBand(
      derived.thresholdPaceSec,
      (bandRows || []).map(r => toBand(r as Record<string, unknown>)),
    );

    const now = new Date().toISOString();
    const summary = typeof body?.summary === 'string' ? body.summary : null;
    const { data: saved, error } = await supabase
      .from('academy_test_analyses')
      .upsert({
        test_id: testId,
        athlete_id: String(test.athlete_id),
        // The audit trail: what the formula said at the moment of the signature. See migration
        // 113 — a coefficient change later must not rewrite the thresholds a plan was written to.
        derived: {
          thresholdPaceSec: derived.thresholdPaceSec,
          thresholdAdjusted: derived.thresholdAdjusted,
          avgHrBpm: derived.avgHrBpm,
          easyPaceSec: derived.easyPaceSec,
          intervalPaceSec: derived.intervalPaceSec,
          predictions: derived.predictions,
        },
        approved,
        recommended_band_id: recommendation.band?.id ?? null,
        band_id: bandId,
        summary,
        status: approving ? 'approved' : 'draft',
        author_id: caller.athleteId || null,
        approved_by: approving ? caller.athleteId || null : null,
        approved_at: approving ? now : null,
        updated_at: now,
      }, { onConflict: 'test_id' })
      .select(ANALYSIS_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ error: 'The analyses table is not set up yet' }, { status: 503 });
      }
      console.error('test analysis upsert failed:', error);
      return NextResponse.json({ error: 'Failed to save the analysis' }, { status: 500 });
    }

    // The effect of the signature, and the only write that leaves this table. Reported separately
    // from the save: a band that could not be written is not a failed approval — the analysis is
    // stored and signed — but it IS something the screen has to say out loud, because the plan
    // composer reads that column and nothing else.
    let bandAssigned: boolean | null = null;
    if (approving && bandId && athlete.academy_band_id !== bandId) {
      const { error: bandError } = await supabase
        .from('athletes')
        .update({ academy_band_id: bandId })
        .eq('id', String(test.athlete_id));
      bandAssigned = !bandError;
      if (bandError) console.error('band assignment failed:', bandError);
    }

    return NextResponse.json({
      analysis: saved
        ? { id: String((saved as unknown as Record<string, unknown>).id), status: approving ? 'approved' : 'draft' }
        : null,
      bandAssigned,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to save the analysis' }, { status: 500 });
  }
}
