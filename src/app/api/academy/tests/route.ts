import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { israelToday } from '@/lib/utils';
import {
  buildRegistry,
  buildTrend,
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
      return NextResponse.json({ protocol, rows: [], summary: emptySummary(), byBand: [] });
    }

    const { data, error } = await supabase
      .from('academy_tests')
      .select(TEST_COLUMNS)
      .in('athlete_id', ids)
      .eq('protocol', protocol)
      .order('test_date', { ascending: true });

    if (error) {
      // Migration 105 is applied by hand and may not be in yet. An empty registry that
      // SAYS it is not set up is a truthful screen; a 500 reads like a bug in the code.
      if (isMissingTable(error)) {
        return NextResponse.json({
          protocol,
          tableMissing: true,
          ...(athleteId ? { trend: buildTrend([], protocol) } : { rows: [], summary: emptySummary(), byBand: [] }),
        });
      }
      return NextResponse.json({ error: 'Failed to read the tests' }, { status: 500 });
    }

    const tests = (data || []).map(toTestRow);

    if (athleteId) {
      return NextResponse.json({ protocol, athleteId, trend: buildTrend(tests, protocol) });
    }

    return NextResponse.json({
      protocol,
      ...buildRegistry({ athletes, tests, protocol, today: israelToday() }),
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
 * Record a test. Staff only, deliberately — unlike `benchmark_results`, which accepts
 * athlete self-submissions behind an approval queue because it is a public leaderboard.
 * This number sets the paces in somebody's plan, so it is not self-reported.
 */
export async function POST(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!caller.isSuperUser && !caller.isStaff) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const athleteId = String(body.athleteId || '');
    const date = String(body.date || '');
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
    if (!isManager && target.academy_coach_id !== caller.athleteId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const row = {
      athlete_id: athleteId,
      test_date: date,
      protocol: String(body.protocol || DEFAULT_PROTOCOL),
      duration_sec: durationSec,
      distance_m: distanceM,
      avg_hr: body.avgHr == null ? null : Number(body.avgHr),
      activity_id: body.activityId || null,
      // Empty string is not a reason. Trimmed to null so a blank field cannot silently
      // exclude a test from the trend it was recorded for.
      excluded_reason: String(body.excludedReason || '').trim() || null,
      notes: String(body.notes || '').trim() || null,
      author_id: caller.athleteId || null,
      updated_at: new Date().toISOString(),
    };

    // Re-recording the same protocol on the same day is a correction, not a second test —
    // migration 105's unique index says so, and upserting is what the coach means.
    const { data, error } = await supabase
      .from('academy_tests')
      .upsert(row, { onConflict: 'athlete_id,test_date,protocol' })
      .select(TEST_COLUMNS)
      .maybeSingle();

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

    return NextResponse.json({ test: data ? toTestRow(data) : null });
  } catch (err: unknown) {
    console.error('POST /api/academy/tests error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
