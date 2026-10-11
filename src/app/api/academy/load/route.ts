import { NextResponse } from 'next/server';
import { loadAthleteFeeds } from '@/lib/academy/data-feed-server';
import { createServerClient } from '@/lib/supabase/server';
import { israelToday } from '@/lib/utils';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { shiftDate, thresholdOn } from '@/lib/academy/load';
import { plannedWeeksFor } from '@/lib/academy/pmc';
import { athleteLoads, BACKFILL_DAYS, loadRaceDate, plannedLoads } from '@/lib/academy/load-server';
import { buildLoadPayload, LOAD_RANGES, type LoadRange } from '@/lib/academy/load-payload';
import { loadTestState } from '@/lib/academy/test-state';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/load?athleteId=…&range=6w|3m|race
 *
 * The trainee's fitness, fatigue and form (mockup 7/7ב, the weekly bars of 3, the coach's
 * C2): the numbers as of yesterday, the series behind the chart, 8 Sunday weeks of done
 * load with each week's planned load (E2), and the test the loads stand on.
 *
 * WHO: the trainee, their coaches and the manager — `mayCoach`, the academy's 1:1 line,
 * the same as /api/academy/workout.
 *
 * SIDE EFFECT: pricing the activities that have no stored load yet (migration 142),
 * bounded per call. Skipped under view-as, which prices them in memory instead.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    const range = (searchParams.get('range') || '6w') as LoadRange;
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!LOAD_RANGES.includes(range)) return NextResponse.json({ error: 'range must be 6w, 3m or race' }, { status: 400 });

    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const today = israelToday();
    const [{ rows, tests, stored, pending }, raceDate, feeds] = await Promise.all([
      athleteLoads(supabase, athleteId, { since: shiftDate(today, -BACKFILL_DAYS), write: !caller.viewingAsBy, today }),
      // Every range: screen 7 offers "עד המרוץ" only when there is a race.
      loadRaceDate(supabase, athleteId),
      loadAthleteFeeds(supabase, athleteId),
    ]);
    // Every shown week's plan, and the 4 before: this week's dashed bar, and "שבוע קל" only
    // for a week the coach planned easy.
    const T = thresholdOn(today, tests)?.thresholdSec ?? null;
    const [planned, testState] = await Promise.all([
      plannedLoads(supabase, athleteId, plannedWeeksFor(today), T),
      // Only without a usable test: which "הערכה לפי דופק" line (none / pending / 2000 m).
      T == null ? loadTestState(supabase, athleteId, today) : Promise.resolve(null),
    ]);

    // A broken feed or runs still being priced withhold the numbers (pmc.ts gateStatus).
    const payload = buildLoadPayload({ rows, tests, today, range, raceDate, plannedByWeek: planned.byWeek, gate: { feed: feeds.run, pending } });
    return NextResponse.json({ ...payload, testKind: testState?.kind ?? null, stored, pending });
  } catch (error: unknown) {
    console.error('Academy load error:', error);
    return NextResponse.json({ error: 'Failed to load the training load' }, { status: 500 });
  }
}
