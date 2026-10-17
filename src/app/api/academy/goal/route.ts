import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { mayCoach } from '@/lib/academy/pairing-server';
import { parseGoalBody } from '@/lib/academy/goal';
import { loadClubRaces, loadGoal, loadThresholdPace, saveGoal } from '@/lib/academy/goal-server';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/goal?athleteId= — everything the goal module needs in one read: the goal
 * itself, the club's upcoming races to choose from, and the threshold pace the target-time
 * estimate is made from. Same gate as the PUT.
 */
export async function GET(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const athleteId = url.searchParams.get('athleteId') || caller.athleteId || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const supabase = createServerClient();
    const today = israelToday();
    const [read, clubRaces, thresholdSecPerKm] = await Promise.all([
      loadGoal(supabase, athleteId),
      loadClubRaces(supabase, today),
      loadThresholdPace(supabase, athleteId),
    ]);
    return NextResponse.json({ athleteId, today, ...read, clubRaces, thresholdSecPerKm });
  } catch (err) {
    console.error('GET /api/academy/goal error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

/**
 * PUT /api/academy/goal — a trainee's goal: `{ athleteId, goalType?, targetRace?,
 * targetRaceDate?, goalTimeSec? }`. Every field is written as sent (null clears it), because
 * the form always sends the whole goal.
 *
 * The trainee themselves (their own goal, on the home card), the manager, or one of their
 * coaches (`mayCoach`). Not approval-gated: a goal prices nothing — it is the race line on their
 * home, and the coach sees it on the list.
 *
 * Migration 144: before it the save answers 503 naming it, and the form says so.
 */
export async function PUT(request: Request) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body.athleteId === 'string' && body.athleteId ? body.athleteId : caller.athleteId || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    if (!(await mayCoach(caller, athleteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { goal, issues } = parseGoalBody(body);
    if (issues.length) return NextResponse.json({ error: 'Invalid goal', fields: issues }, { status: 400 });

    const supabase = createServerClient();
    const { data: target } = await supabase.from('athletes').select('id, is_academy').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
    if (!target?.is_academy) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const saved = await saveGoal(supabase, athleteId, goal, caller.athleteId);
    if (!saved.ok) {
      return saved.tableMissing
        ? NextResponse.json({ error: 'Goals are not set up yet (migration 144)', tableMissing: true }, { status: 503 })
        : NextResponse.json({ error: 'Failed to save the goal' }, { status: 500 });
    }
    return NextResponse.json({ athleteId, goal });
  } catch (err) {
    console.error('PUT /api/academy/goal error:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
