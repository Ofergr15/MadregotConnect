import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { readCharacterization, readWeekdays, type Characterization } from '@/lib/academy/characterization';

export const dynamic = 'force-dynamic';

/**
 * The characterization call's answers.
 *
 *   GET /api/academy/characterization?candidateId=…  → the answers so far, or null
 *   PUT /api/academy/characterization                → save them (upsert on candidate_id)
 *
 * STAFF ONLY, with no "self" case — the same rule as the candidates route and for a stronger
 * reason: this table holds a stranger's injuries and the coach's private verdict on whether
 * they are worth taking on. There is no account behind a candidate to be the "self" anyway.
 *
 * ── WHY PUT AND NOT POST ─────────────────────────────────────────────────────────────────
 *
 * The form is filled WHILE the phone call is happening and saves itself as it goes (the
 * mockup's footer says `נשמר אוטומטית`), so the same candidate's answers are written a dozen
 * times in twenty minutes. Every one of those writes must CORRECT the previous one, which is
 * what the `UNIQUE (candidate_id)` index and an upsert give. A POST-per-save would leave the
 * academy with twelve opinions about which days somebody can run and no way to tell which one
 * the coach meant.
 *
 * ── WHY THIS ROUTE DOES NOT COMPLETE THE STEP ────────────────────────────────────────────
 *
 * Saving the form does not mark `characterization` done on the funnel. The form's own button
 * calls the EXISTING `PATCH /api/academy/candidates { action: 'step', stage: 'characterization' }`
 * — the same request the card's `בוצע` button already makes — so there is exactly one code path
 * that moves a candidate between columns. Two doors into one stage is the failure the funnel's
 * route tests already guard against: the same candidate ends up in different columns depending
 * on which screen recorded them, and the board silently disagrees with itself.
 *
 * It also keeps the honest case honest. A call can happen and be recorded with the form barely
 * filled in — the coach ran out of time, the person had to go — and a route that stamped the
 * step on save would refuse to believe a call happened until every field was answered.
 */

const COLUMNS =
  'candidate_id, goal_type, target_race, target_race_date, weekly_km, years_running, '
  + 'available_days, limitations, watch, pr_distance_m, pr_time_sec, fit, recorded_by, updated_at';

/** Migration 111 is pasted in by hand, so every handler has to survive its absence. */
const NOT_SET_UP = { characterization: null, tableMissing: true };

async function staffOnly(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied };
  if (!(caller.isSuperUser || caller.isStaff)) {
    return { denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }) };
  }
  return { caller };
}

/** A number in range, or null. Anything unparseable is "no answer", never 0. */
function boundedNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  // Clamped and not rejected: the plausibility warnings live in the pure module and are shown
  // to the coach, whose answer is allowed to be surprising. What the COLUMN cannot take is a
  // number outside NUMERIC(5,1) — that is a 500 on a keystroke during a phone call.
  return Math.min(max, Math.max(min, n));
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A `YYYY-MM-DD` day, or null. A DATE column rejects anything else with a 500. */
function isoDay(value: unknown): string | null {
  const t = trimmed(value);
  if (!t) return null;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(t)?.[1];
  return day && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ? day : null;
}

export async function GET(request: Request) {
  try {
    const gate = await staffOnly(request);
    if (gate.denied) return gate.denied;

    const candidateId = new URL(request.url).searchParams.get('candidateId') || '';
    if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('academy_characterizations')
      .select(COLUMNS)
      .eq('candidate_id', candidateId)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP);
      return NextResponse.json({ error: 'Failed to read the characterization' }, { status: 500 });
    }

    // `null` and not an empty form: "nobody has characterised him" and "somebody sat down and
    // answered nothing" are different facts, and only the caller knows which screen it is
    // building. The pure module's `emptyCharacterization` is there for the second one.
    return NextResponse.json({
      characterization: data ? readCharacterization(data as unknown as Record<string, unknown>) : null,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read the characterization' }, { status: 500 });
  }
}

/**
 * Save the answers.
 *
 *   { candidateId, goalType?, targetRace?, targetRaceDate?, weeklyKm?, yearsRunning?,
 *     availableDays?: number[], limitations?, watch?, prDistanceM?, prTimeSec?, fit? }
 *
 * The WHOLE form every time, not a patch of changed fields: the client holds the form state
 * and an autosave that sent only what moved could never clear an answer — unselecting a
 * training day would leave the old array in place, and the coach would watch the day come back.
 */
export async function PUT(request: Request) {
  try {
    const gate = await staffOnly(request);
    if (gate.denied) return gate.denied;

    const body = await request.json().catch(() => ({}));
    const candidateId = String(body?.candidateId || '');
    if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });

    const supabase = createServerClient();
    // The candidate has to exist. The foreign key would catch it anyway, but as a 500 during a
    // phone call rather than as an answer.
    const { data: candidate, error: readError } = await supabase
      .from('academy_candidates')
      .select('id')
      .eq('id', candidateId)
      .maybeSingle();
    if (readError) {
      if (isMissingTable(readError)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to read the candidate' }, { status: 500 });
    }
    if (!candidate) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Read through the pure module first, so the stored value and the value the screen just
    // validated are the same value: unknown goal/fit keys become null, a half-quoted personal
    // best is dropped rather than half-stored, and the day list is cleaned once.
    const clean: Characterization = readCharacterization({
      candidate_id: candidateId,
      goal_type: trimmed(body?.goalType),
      target_race: trimmed(body?.targetRace),
      target_race_date: isoDay(body?.targetRaceDate),
      // NUMERIC(5,1) and NUMERIC(3,1): the column's own limits, not a judgement about running.
      weekly_km: boundedNumber(body?.weeklyKm, 0, 9999.9),
      years_running: boundedNumber(body?.yearsRunning, 0, 99.9),
      available_days: readWeekdays(body?.availableDays),
      limitations: trimmed(body?.limitations),
      watch: trimmed(body?.watch),
      pr_distance_m: boundedNumber(body?.prDistanceM, 0, 1_000_000),
      pr_time_sec: boundedNumber(body?.prTimeSec, 0, 1_000_000),
      fit: trimmed(body?.fit),
    });

    const { data, error } = await supabase
      .from('academy_characterizations')
      .upsert(
        {
          candidate_id: candidateId,
          goal_type: clean.goalType,
          target_race: clean.targetRace,
          target_race_date: clean.targetRaceDate,
          weekly_km: clean.weeklyKm,
          years_running: clean.yearsRunning,
          // An empty selection is stored as an empty array and not as NULL, so "he has no free
          // mornings" and "nobody asked yet" stay distinguishable in the table itself.
          available_days: clean.availableDays,
          limitations: clean.limitations,
          watch: clean.watch,
          pr_distance_m: clean.prDistanceM === null ? null : Math.round(clean.prDistanceM),
          pr_time_sec: clean.prTimeSec === null ? null : Math.round(clean.prTimeSec),
          fit: clean.fit,
          // Whoever saved last is who characterised him. The academy has more than one
          // interviewer and "who spoke to him" is a real question three weeks later.
          recorded_by: gate.caller!.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'candidate_id' },
      )
      .select(COLUMNS)
      .single();

    if (error) {
      if (isMissingTable(error)) return NextResponse.json(NOT_SET_UP, { status: 503 });
      return NextResponse.json({ error: 'Failed to save the characterization' }, { status: 500 });
    }

    return NextResponse.json({ characterization: readCharacterization(data as unknown as Record<string, unknown>) });
  } catch {
    return NextResponse.json({ error: 'Failed to save the characterization' }, { status: 500 });
  }
}
