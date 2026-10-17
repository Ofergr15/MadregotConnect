import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { COACH_ID } from '@/lib/constants';
import { mayCoach } from '@/lib/academy/pairing-server';
import { blockLine, distanceLabel, goalProgress, goalTimeText, parseGoalBody, type Goal } from '@/lib/academy/goal';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { notifyAthlete } from '@/lib/push';
import { academyGoalSetCopy } from '@/lib/notifications/copy';
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
    const { data: target } = await supabase.from('athletes').select('id, name, is_academy, academy_coach_id').eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
    if (!target?.is_academy) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const saved = await saveGoal(supabase, athleteId, goal, caller.athleteId);
    if (!saved.ok) {
      return saved.tableMissing
        ? NextResponse.json({ error: 'Goals are not set up yet (migration 144)', tableMissing: true }, { status: 503 })
        : NextResponse.json({ error: 'Failed to save the goal' }, { status: 500 });
    }
    // A goal the trainee set THEMSELVES reaches their coaches (mockup G4): the race, the
    // target, and where it lands in a block — what the coach needs to decide how to plan. A
    // goal the coach set needs no message to that coach. Best-effort, never the save's failure.
    if (caller.athleteId === athleteId && goal.targetRace) {
      try {
        const coaches = (await coachIdsOf(supabase, athleteId, (target as { academy_coach_id?: string | null }).academy_coach_id ?? null))
          .filter((c) => c && c !== athleteId);
        await Promise.allSettled(coaches.map((coachId) => notifyAthlete({
          athleteId: coachId,
          kind: 'academy_goal_set',
          actorAthleteId: athleteId,
          copy: (locale) => academyGoalSetCopy(locale, {
            name: String((target as { name?: string | null }).name ?? ''),
            race: goal.targetRace as string,
            detail: goalDetail(goal, locale === 'he' ? 'he' : 'en'),
            block: goal.targetRaceDate ? blockLine(goalProgress(goal.targetRaceDate, israelToday(), goal.distanceKm), locale === 'he' ? 'he' : 'en') : '',
          }),
          url: '/dashboard/academy?tab=members',
          // Per trainee: changing the goal twice replaces the first message.
          tag: `academy-goal-${athleteId}`,
        })));
      } catch (e) {
        console.error('PUT /api/academy/goal: coach notify failed:', e);
      }
    }
    return NextResponse.json({ athleteId, goal });
  } catch (err) {
    console.error('PUT /api/academy/goal error:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

/** "42.2 · 6.12 · יעד 3:20" for the coach's message. */
function goalDetail(goal: Goal, locale: 'he' | 'en'): string {
  const d = goal.targetRaceDate;
  return [
    goal.distanceKm ? distanceLabel(goal.distanceKm) : null,
    d ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}${goal.dateIsEstimate ? '?' : ''}` : null,
    goal.goalTimeSec ? `${locale === 'he' ? 'יעד' : 'target'} ${goalTimeText(goal.goalTimeSec)}` : null,
  ].filter(Boolean).join(' · ');
}

