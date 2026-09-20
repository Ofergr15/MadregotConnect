import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { planInputsFrom, readCharacterization, type PlanInputs } from '@/lib/academy/characterization';

export const dynamic = 'force-dynamic';

/**
 * What the characterization call said, for the trainees a week is about to be pushed to.
 *
 *   GET /api/academy/plan-inputs?athleteIds=a,b,c  →  { inputs: { [athleteId]: PlanInputs } }
 *
 * The composer is the only caller. It knows ATHLETES; the answers are keyed by CANDIDATE, because
 * they were recorded before the person had an account (`academy_characterizations.candidate_id`,
 * migration 111). `academy_candidates.athlete_id` is the join, and the funnel's own design note
 * is why it exists: "the row survives joining and becomes the trainee's history".
 *
 * ── WHY A SEPARATE ROUTE AND NOT A PARAMETER ON `characterization` ────────────────────────
 *
 * That route answers "the answers so far, or null" for ONE candidate and is written for the form
 * that is being filled in during the call — it returns the raw answers, including the coach's
 * private `fit` verdict on whether a stranger is worth taking on. This one answers a different
 * question for a list of athletes, and returns only `PlanInputs`: the subset that is an input to
 * a plan. The composer has no business receiving the verdict, and the form has no business
 * receiving somebody else's derived readiness.
 *
 * ── WHY IT NEVER 404s ────────────────────────────────────────────────────────────────────
 *
 * An athlete with no candidate row, a candidate with no characterization, and an unpasted
 * migration 111 are three different reasons for the same answer, and none of them is an error:
 * most of the club was never characterised, because the form is newer than the roster. So the
 * shape is a map of what IS known, and the caller's rule (see `plan-fit.ts`) is that an athlete
 * missing from it produces no findings at all rather than a default.
 *
 * STAFF ONLY, like the characterization route — the limitation field is somebody's injury. Not
 * manager-only: unlike the payments board, this is the coach's own working material for a
 * trainee they are writing a plan for.
 */

/** As many trainees as the composer can select at once, with room to spare. */
const MAX_IDS = 40;

const COLUMNS =
  'candidate_id, goal_type, target_race, target_race_date, weekly_km, years_running, '
  + 'available_days, limitations, watch, pr_distance_m, pr_time_sec, fit, recorded_by';

export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    if (!(caller.isSuperUser || caller.isStaff)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const athleteIds = [...new Set(
      (new URL(request.url).searchParams.get('athleteIds') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    )].slice(0, MAX_IDS);

    // An empty ask is an empty answer, not a 400: the composer fires this whenever the selection
    // changes, including the moment it is cleared.
    if (!athleteIds.length) return NextResponse.json({ inputs: {} });

    const supabase = createServerClient();

    const { data: candidates, error: candidateError } = await supabase
      .from('academy_candidates')
      .select('id, athlete_id')
      .in('athlete_id', athleteIds);

    if (candidateError) {
      if (isMissingTable(candidateError)) return NextResponse.json({ inputs: {}, tableMissing: true });
      return NextResponse.json({ error: 'Failed to read the plan inputs' }, { status: 500 });
    }

    /** candidate_id → athlete_id. The characterizations come back keyed the other way. */
    const athleteOf = new Map<string, string>();
    for (const row of candidates || []) {
      const candidateId = String((row as { id?: unknown }).id ?? '');
      const athleteId = String((row as { athlete_id?: unknown }).athlete_id ?? '');
      if (candidateId && athleteId) athleteOf.set(candidateId, athleteId);
    }
    if (!athleteOf.size) return NextResponse.json({ inputs: {} });

    const { data: rows, error: characterizationError } = await supabase
      .from('academy_characterizations')
      .select(COLUMNS)
      .in('candidate_id', [...athleteOf.keys()]);

    if (characterizationError) {
      if (isMissingTable(characterizationError)) return NextResponse.json({ inputs: {}, tableMissing: true });
      return NextResponse.json({ error: 'Failed to read the plan inputs' }, { status: 500 });
    }

    // The server's day, because `weeksToRace` is a countdown and the pure module refuses to read
    // a clock. The composer's own week already comes from the same place (`planWeekStartOf`).
    const today = new Date().toISOString().slice(0, 10);

    const inputs: Record<string, PlanInputs> = {};
    for (const row of rows || []) {
      const record = row as unknown as Record<string, unknown>;
      const athleteId = athleteOf.get(String(record.candidate_id ?? ''));
      if (!athleteId) continue;
      inputs[athleteId] = planInputsFrom(readCharacterization(record), today);
    }

    return NextResponse.json({ inputs });
  } catch {
    return NextResponse.json({ error: 'Failed to read the plan inputs' }, { status: 500 });
  }
}
