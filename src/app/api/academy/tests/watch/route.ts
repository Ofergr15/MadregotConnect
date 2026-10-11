import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { mayCoach } from '@/lib/academy/pairing-server';
import { shiftDate } from '@/lib/academy/load';
import { readAll } from '@/lib/academy/load-server';
import { WINDOW_DAYS, findTestRuns, type FinderActivity } from '@/lib/academy/test-finder';

export const dynamic = 'force-dynamic';

const COLUMNS = 'id, start_time, activity_name, activity_type, source, distance, duration, moving_duration, average_hr, laps';

/**
 * GET /api/academy/tests/watch?athleteId=… — "למשוך מהשעון" (mockup academy-existing-trainees,
 * phone 3): the runs of the last six months that look like a test, best first, at most three,
 * and why there are none when there are none (lib/academy/test-finder.ts).
 *
 * The trainee themselves, the manager, or one of their coaches (`mayCoach`) — the same people
 * who may record that trainee's test. Reads only: choosing a run posts it to
 * POST /api/academy/tests like a typed result, so every write rule stays in one place.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const athleteId = new URL(request.url).searchParams.get('athleteId') || caller.athleteId || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const supabase = createServerClient();
    const today = israelToday();
    // A day of slack on the start: `start_time` is the watch's wall clock stored as UTC.
    const since = shiftDate(today, -(WINDOW_DAYS + 1));
    const [acts, tests] = await Promise.all([
      readAll<FinderActivity>((from, to) => supabase
        .from('athlete_activities')
        .select(COLUMNS)
        .eq('athlete_id', athleteId)
        .gte('start_time', `${since}T00:00:00Z`)
        .order('start_time', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), 200),
      supabase.from('academy_tests').select('test_date, protocol').eq('athlete_id', athleteId),
    ]);
    if (acts.error) return NextResponse.json({ error: 'Failed to read the runs' }, { status: 500 });

    const result = findTestRuns(acts.data, today);
    return NextResponse.json({
      ...result,
      windowDays: WINDOW_DAYS,
      // Tests already on record, so a run already saved for that day is not offered as new.
      recorded: ((tests.error ? [] : tests.data) || []).map((t: any) => `${String(t.test_date).slice(0, 10)}:${t.protocol || '30min'}`),
    });
  } catch (err) {
    console.error('GET /api/academy/tests/watch error:', err);
    return NextResponse.json({ error: 'Failed to look' }, { status: 500 });
  }
}
