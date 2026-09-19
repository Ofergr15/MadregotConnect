import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingColumn, isMissingTable, withoutColumns } from '@/lib/supabase/schema-drift';
import { israelToday } from '@/lib/utils';
import {
  buildRegistry,
  buildTrend,
  paceLooksImplausible,
  thresholdPaceSec,
  type RegistryAthlete,
  type RegistrySummary,
  type TestRow,
} from '@/lib/academy/tests';

export const dynamic = 'force-dynamic';

/**
 * The academy's test registry and improvement trend.
 *
 *   GET  /api/academy/tests?protocol=30min              → the registry (who is overdue)
 *   GET  /api/academy/tests?protocol=30min&athleteId=x  → that athlete's trend
 *   POST /api/academy/tests                             → record a result
 *
 * STAFF ONLY on the registry, and scoped like every other academy staff route: a manager
 * sees the roster, a coach sees their own trainees. An athlete may read their OWN trend —
 * it is their improvement graph, and the mockup shows it to them ("השיפור שלך").
 *
 * `protocol` is required and never defaulted across reads for the reason
 * `lib/academy/tests.ts` opens with: a 2000m and a 30-minute effort produce different
 * paces at identical fitness, so mixing them draws a graph in which switching protocol
 * looks like a breakthrough.
 */

const DEFAULT_PROTOCOL = '30min';

/** The row shape, mapped once so the pure lib never sees snake_case. */
const TEST_COLUMNS =
  'id, athlete_id, test_date, protocol, duration_sec, distance_m, avg_hr, activity_id, excluded_reason, notes';

/**
 * The same row plus migration 108's approval columns.
 *
 * Two lists rather than one because 108 is pasted in by hand like every migration here, so
 * there is a window where this code is deployed and the columns are not there. Selecting
 * them then fails the whole read with 42703 — an empty graph, not a degraded one — so the
 * read falls back to `TEST_COLUMNS` and treats everything as approved, which is exactly
 * what every row in the table is before 108 runs.
 */
const TEST_COLUMNS_WITH_STATUS = `${TEST_COLUMNS}, status, submitted_by, submitted_at`;

/** A test as stored: the pure row, plus whether it is allowed to count yet. */
type StoredTest = TestRow & {
  status: 'approved' | 'pending';
  submittedBy: string | null;
  submittedAt: string | null;
};

function toStoredTest(row: any): StoredTest {
  return {
    ...toTestRow(row),
    // Absent column, absent value, or a value this code does not know: approved. A row
    // whose status cannot be read is one of the club's own historical tests, and the
    // failure mode of guessing 'pending' is erasing the entire trend.
    status: row.status === 'pending' ? 'pending' : 'approved',
    submittedBy: row.submitted_by ?? null,
    submittedAt: row.submitted_at ?? null,
  };
}

function toTestRow(row: any): TestRow {
  return {
    id: String(row.id),
    athleteId: String(row.athlete_id),
    date: String(row.test_date).slice(0, 10),
    protocol: String(row.protocol || DEFAULT_PROTOCOL),
    durationSec: Number(row.duration_sec),
    distanceM: Number(row.distance_m),
    avgHr: row.avg_hr == null ? null : Number(row.avg_hr),
    excludedReason: row.excluded_reason ?? null,
  };
}

/**
 * The academy roster this caller may see, with the band each athlete trains in.
 *
 * `academy_bands` is joined rather than counted here because the per-band rollup is the
 * manager's actual question — "does the method work, and does it work the same at every
 * level" — and a rollup keyed on a UUID answers nobody.
 */
async function roster(supabase: any, callerAthleteId: string | null, isManager: boolean) {
  const { data, error } = await supabase
    .from('athletes')
    .select('id, name, is_academy, academy_coach_id, academy_band_id, academy_bands(band_number)')
    .eq('coach_id', COACH_ID);
  if (error) return { error };
  const athletes: RegistryAthlete[] = (data || [])
    .filter((a: any) => a.is_academy)
    .filter((a: any) => isManager || (a.academy_coach_id && a.academy_coach_id === callerAthleteId))
    .map((a: any) => ({
      id: a.id,
      name: a.name || a.id,
      bandNumber: a.academy_bands?.band_number ?? null,
    }));
  return { athletes };
}

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const protocol = url.searchParams.get('protocol') || DEFAULT_PROTOCOL;
    const athleteId = url.searchParams.get('athleteId');
    const isManager = caller.isSuperUser || caller.role === 'admin';
    const isStaff = caller.isSuperUser || caller.isStaff;

    // An athlete asking for their own graph is the trainee-facing case and is allowed.
    // Anyone asking about somebody ELSE must be staff, and a coach only about their own.
    const ownGraph = !!athleteId && athleteId === caller.athleteId;
    if (!ownGraph && !isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const supabase = createServerClient();

    let ids: string[];
    let athletes: RegistryAthlete[] = [];
    if (ownGraph) {
      ids = [athleteId!];
    } else {
      const result = await roster(supabase, caller.athleteId, isManager);
      if (result.error) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
      athletes = result.athletes!;
      if (athleteId) {
        // A coach may not read a trainee who is not theirs, and must not learn from the
        // response whether that trainee exists.
        if (!athletes.some(a => a.id === athleteId)) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        ids = [athleteId];
      } else {
        ids = athletes.map(a => a.id);
      }
    }

    if (ids.length === 0) {
      return NextResponse.json({ protocol, rows: [], summary: emptySummary(), byBand: [], pending: [] });
    }

    // Migration 108's columns first, falling back to the pre-108 shape. See
    // `TEST_COLUMNS_WITH_STATUS`.
    // Typed loosely on purpose: the two selects return different shapes, and the whole
    // point of the fallback is that the second one is the first minus three columns.
    let data: any[] | null = null;
    let error: unknown = null;
    ({ data, error } = await supabase
      .from('academy_tests')
      .select(TEST_COLUMNS_WITH_STATUS)
      .in('athlete_id', ids)
      .eq('protocol', protocol)
      .order('test_date', { ascending: true }));
    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase
        .from('academy_tests')
        .select(TEST_COLUMNS)
        .in('athlete_id', ids)
        .eq('protocol', protocol)
        .order('test_date', { ascending: true }));
    }

    if (error) {
      // Migration 105 is applied by hand and may not be in yet. An empty registry that
      // SAYS it is not set up is a truthful screen; a 500 reads like a bug in the code.
      if (isMissingTable(error)) {
        return NextResponse.json({
          protocol,
          tableMissing: true,
          pending: [],
          ...(athleteId ? { trend: buildTrend([], protocol) } : { rows: [], summary: emptySummary(), byBand: [] }),
        });
      }
      return NextResponse.json({ error: 'Failed to read the tests' }, { status: 500 });
    }

    const stored = (data || []).map(toStoredTest);

    // ── Pending counts toward nothing ──────────────────────────────────────────
    //
    // A submission the coach has not approved must not reach the threshold, the trend, or
    // the staleness clock — that is the whole promise of the approval step. Filtered here
    // rather than inside `lib/academy/tests.ts`, which stays a pure function of the tests
    // it is handed: "which rows are allowed to count" is an authorisation question, and
    // the lib has no business knowing the answer.
    //
    // It also means an unapproved submission leaves the athlete showing as overdue, which
    // is correct and deliberate: until somebody checks the number, the plan really is
    // running on the old threshold.
    const tests = stored.filter(t => t.status === 'approved');
    const pending = stored
      .filter(t => t.status === 'pending')
      .map(t => ({
        testId: t.id,
        athleteId: t.athleteId,
        name: athletes.find(a => a.id === t.athleteId)?.name ?? null,
        date: t.date,
        protocol: t.protocol,
        durationSec: t.durationSec,
        distanceM: t.distanceM,
        avgHr: t.avgHr ?? null,
        paceSec: thresholdPaceSec(t),
        submittedAt: t.submittedAt,
        // Flags a submission the coach should look at twice before it prices a plan.
        implausible: paceLooksImplausible(thresholdPaceSec(t)),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    if (athleteId) {
      return NextResponse.json({ protocol, athleteId, trend: buildTrend(tests, protocol), pending });
    }

    return NextResponse.json({
      protocol,
      ...buildRegistry({ athletes, tests, protocol, today: israelToday() }),
      pending,
      scope: isManager ? 'academy' : 'coach',
    });
  } catch (err: unknown) {
    console.error('GET /api/academy/tests error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Every key of `RegistrySummary`, and typed as one so it cannot drift.
 *
 * It already did: `noDelta` was added to the summary and this literal kept returning four
 * keys, so an empty roster would have rendered a KPI the screen expects as `undefined`.
 * The annotation is the whole fix — an untyped object literal here is invisible to tsc.
 */
function emptySummary(): RegistrySummary {
  return { improved: 0, same: 0, regressed: 0, noDelta: 0, overdue: 0, neverTested: 0 };
}

/**
 * Record a test.
 *
 * Staff entry is immediate. An academy trainee may submit their OWN test, and it waits as
 * `status='pending'` until staff approve it — the shape `benchmark_results` already uses,
 * for the reason migration 108's header gives: this number prices every workout in that
 * athlete's plan, so "the runner types it" must not mean "the runner sets their own paces".
 *
 * Three things make the self-submission safe, and all three are enforced here rather than
 * in the client:
 *
 *   · The `athleteId` in the body is IGNORED for a non-staff caller. It is not validated
 *     against the session and then used — it is replaced by the session's own athlete, so
 *     there is no version of this request that writes to somebody else's history.
 *   · A submission cannot overwrite an APPROVED test. The upsert's whole purpose is that
 *     re-recording a day is a correction, which is right for a coach and wrong here: it
 *     would let a trainee replace the coach's measured number with their own and flip it
 *     back to pending. Same day, already approved → 409, and the screen says to talk to
 *     their coach.
 *   · `excludedReason` is staff-only. Throwing a test out of the trend is a coaching
 *     judgement; accepting it from the athlete would let anyone delete their own bad day.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const isStaff = caller.isSuperUser || caller.isStaff;

    const body = await request.json().catch(() => ({}));
    // Self-submission: the session decides who this is for, never the request body.
    const requestedId = String(body.athleteId || '');
    const athleteId = isStaff ? requestedId : String(caller.athleteId || '');
    if (!isStaff && requestedId && requestedId !== athleteId) {
      return NextResponse.json({ error: 'You can only submit your own test' }, { status: 403 });
    }
    const date = String(body.date || '');
    const protocol = String(body.protocol || DEFAULT_PROTOCOL);
    const durationSec = Number(body.durationSec);
    const distanceM = Number(body.distanceM);

    if (!athleteId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'athleteId and date=YYYY-MM-DD are required' }, { status: 400 });
    }
    // Both, always: the threshold is duration/distance for every protocol, so a row
    // missing either one is a test whose whole purpose cannot be computed.
    if (!(durationSec > 0) || !(distanceM > 0)) {
      return NextResponse.json({ error: 'durationSec and distanceM must both be positive' }, { status: 400 });
    }

    const supabase = createServerClient();

    // A coach may only record for their own trainees; the manager for anyone in the academy.
    const isManager = caller.isSuperUser || caller.role === 'admin';
    const { data: target } = await supabase
      .from('athletes')
      .select('id, is_academy, academy_coach_id')
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID)
      .maybeSingle();
    if (!target?.is_academy) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // A coach is confined to their own trainees. A trainee submitting for themselves is
    // neither — their `academy_coach_id` points at their coach, not at them, so the coach
    // check would reject the one person who is unambiguously entitled to this row.
    if (isStaff && !isManager && target.academy_coach_id !== caller.athleteId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Already measured for that day? A trainee may correct their own pending submission and
    // nothing else. See the header.
    if (!isStaff) {
      let existing = await supabase
        .from('academy_tests')
        .select('id, status')
        .eq('athlete_id', athleteId).eq('test_date', date).eq('protocol', protocol)
        .maybeSingle();
      if (existing.error && isMissingColumn(existing.error)) {
        // Pre-108 there is no status column and therefore no pending row anywhere, so any
        // row that exists is the coach's.
        existing = await supabase
          .from('academy_tests')
          .select('id')
          .eq('athlete_id', athleteId).eq('test_date', date).eq('protocol', protocol)
          .maybeSingle();
      }
      if (existing.data && (existing.data as any).status !== 'pending') {
        return NextResponse.json(
          { error: 'A test for that day is already recorded. Ask your coach to change it.' },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    const row = {
      athlete_id: athleteId,
      test_date: date,
      protocol,
      duration_sec: durationSec,
      distance_m: distanceM,
      avg_hr: body.avgHr == null ? null : Number(body.avgHr),
      activity_id: body.activityId || null,
      // Empty string is not a reason. Trimmed to null so a blank field cannot silently
      // exclude a test from the trend it was recorded for. Staff only — see the header.
      excluded_reason: isStaff ? String(body.excludedReason || '').trim() || null : null,
      notes: String(body.notes || '').trim() || null,
      author_id: caller.athleteId || null,
      // Migration 108. Staff entry arrives approved, and is stamped so the row can say who
      // let this number start pricing a plan.
      status: isStaff ? 'approved' : 'pending',
      submitted_by: isStaff ? null : caller.athleteId || null,
      submitted_at: isStaff ? null : now,
      approved_by: isStaff ? caller.athleteId || null : null,
      approved_at: isStaff ? now : null,
      updated_at: now,
    };
    const APPROVAL_COLUMNS = ['status', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at'];

    // Re-recording the same protocol on the same day is a correction, not a second test —
    // migration 105's unique index says so, and upserting is what the coach means.
    let { data, error } = await supabase
      .from('academy_tests')
      .upsert(row, { onConflict: 'athlete_id,test_date,protocol' })
      .select(TEST_COLUMNS)
      .maybeSingle();

    // Pre-108, the approval columns do not exist. A COACH's row is approved either way, so
    // dropping them and saving is right. A trainee's submission is not: stored without a
    // status it would read as approved and start pricing their plan unreviewed, which is
    // the exact thing the queue exists to prevent. Refuse instead, and name the migration.
    if (error && isMissingColumn(error)) {
      if (!isStaff) {
        return NextResponse.json(
          { error: 'Athlete submissions are not set up yet (migration 108)' },
          { status: 503 },
        );
      }
      ({ data, error } = await supabase
        .from('academy_tests')
        .upsert(withoutColumns([row], APPROVAL_COLUMNS)[0], { onConflict: 'athlete_id,test_date,protocol' })
        .select(TEST_COLUMNS)
        .maybeSingle());
    }

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          { error: 'academy_tests is not set up yet (migration 105)' },
          { status: 503 },
        );
      }
      console.error('POST /api/academy/tests failed:', error);
      return NextResponse.json({ error: 'Failed to save the test' }, { status: 500 });
    }

    return NextResponse.json({
      test: data ? toTestRow(data) : null,
      // The screen must not say "saved, here is your new pace" for something nobody has
      // looked at yet.
      pending: !isStaff,
    });
  } catch (err: unknown) {
    console.error('POST /api/academy/tests error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Approve or reject a trainee's submission.
 *
 *   PATCH /api/academy/tests  { testId, action: 'approve' | 'reject' }
 *
 * Staff only, and scoped exactly like the registry: a manager may act on anyone in the
 * academy, a coach only on their own trainees. The scope is resolved from the roster rather
 * than from the row, so a coach handed somebody else's `testId` gets the same 404 a
 * non-existent id gets — the response must not confirm that another coach's trainee exists.
 *
 * Reject DELETES the row instead of parking it in a third state. A rejected test is a
 * number that was wrong, and keeping it would mean every later read has to remember to
 * filter a status that never becomes anything — the same trap as a boolean beside
 * `excluded_reason`. Excluding a test that really was run is what `excluded_reason` is for,
 * and that stays a coaching judgement on an approved row.
 */
export async function PATCH(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const testId = String(body.testId || '');
    const action = String(body.action || '');
    if (!testId || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json({ error: "testId and action ('approve'|'reject') are required" }, { status: 400 });
    }

    const supabase = createServerClient();
    const isManager = caller.isSuperUser || caller.role === 'admin';

    const result = await roster(supabase, caller.athleteId, isManager);
    if (result.error) return NextResponse.json({ error: 'Failed to read the roster' }, { status: 500 });
    const allowed = new Set((result.athletes || []).map(a => a.id));

    const { data: target, error: readError } = await supabase
      .from('academy_tests')
      .select('id, athlete_id, status')
      .eq('id', testId)
      .maybeSingle();
    if (readError) {
      if (isMissingTable(readError) || isMissingColumn(readError)) {
        return NextResponse.json({ error: 'Approvals are not set up yet (migration 108)' }, { status: 503 });
      }
      return NextResponse.json({ error: 'Failed to read the test' }, { status: 500 });
    }
    if (!target || !allowed.has(String(target.athlete_id))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Approving an approved row is not an error worth failing a screen over, but it must
    // not re-stamp who approved it: the first decision is the one that happened.
    if (target.status !== 'pending') {
      return NextResponse.json({ testId, status: 'approved', alreadyDecided: true });
    }

    if (action === 'reject') {
      const { error } = await supabase.from('academy_tests').delete().eq('id', testId);
      if (error) return NextResponse.json({ error: 'Failed to reject the test' }, { status: 500 });
      return NextResponse.json({ testId, status: 'rejected' });
    }

    const { error } = await supabase
      .from('academy_tests')
      .update({
        status: 'approved',
        approved_by: caller.athleteId || null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', testId);
    if (error) return NextResponse.json({ error: 'Failed to approve the test' }, { status: 500 });
    return NextResponse.json({ testId, status: 'approved' });
  } catch (err: unknown) {
    console.error('PATCH /api/academy/tests error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
