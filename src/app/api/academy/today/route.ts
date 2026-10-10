import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, israelNow, israelToday, planWeekStartOf } from '@/lib/utils';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { mayCoach } from '@/lib/academy/pairing-server';
import { planRowsFilter } from '@/lib/plans/scope';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { toBand } from '@/lib/academy/bands';
import { loadPaceUpdateCard } from '@/lib/academy/coach-tools-server';
import { loadLaneReferences } from '@/lib/academy/book-server';
import { dayCards } from '@/lib/academy/day-cards';
import { goalCard } from '@/lib/academy/trainee-home';
import { isRunType, shiftDate } from '@/lib/academy/load';
import { athleteLoads, BACKFILL_DAYS } from '@/lib/academy/load-server';
import { loadCoachRows, loadGoalCharacterization, loadTraineeUnread } from '@/lib/academy/me-reads';
import type { TestInvitation } from '@/lib/academy/testInvite';
import {
  buildTraineeToday, EVENING_LOOKAHEAD_HOUR, invitationSlot, todayRace, type TraineeToday,
} from '@/lib/academy/trainee-today';

export const dynamic = 'force-dynamic';

/** The mornings the ranges are read over: 30 before the newest, plus the newest. */
const NIGHTS = 31;

const ME_COLS = 'id, name, gender, group_id, is_academy, academy_coach_id, academy_band_id';
const ME_COLS_FALLBACK = 'id, name, group_id, is_academy';

/**
 * GET /api/academy/today?athleteId=…
 *
 * The academy trainee's home (mockup trainee-experience-v2, phones 1, 1ב, 1ג): today's
 * session (or tomorrow's from 20:00 Israel, dashboard/page.tsx's rule), the rest day with
 * tomorrow under it, the coach's pace update, the test invitation when it is the next
 * thing that matters, how they arrive at the day (form, as of yesterday), last night's
 * sleep and resting HR against their own range, and the race.
 *
 * WHOSE PLAN: the trainee's OWN weekly_plans row for the week, else the club's group plan
 * in their group's variant — never another trainee's (lib/plans/scope.ts `pickPlan`).
 *
 * ONE ROUND of reads, side by side: the cost of this screen on production is the number
 * of round trips (~225 ms each until the Frankfurt move), not the size of any answer. The
 * coach header, unread count, pace update and goal are the /api/academy/me helpers.
 *
 * WHO: the trainee, their coaches, the manager (`mayCoach`). SIDE EFFECT: pricing runs
 * that have no stored load yet (migration 142), bounded, skipped under view-as.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId') || '';
    if (!athleteId) return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });

    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    if (!(await mayCoach(caller, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const supabase = createServerClient();
    const now = new Date();
    const today = israelToday(now);
    const evening = israelNow(now).hour >= EVENING_LOOKAHEAD_HOUR;

    let me: any = null;
    {
      const primary = await supabase.from('athletes').select(ME_COLS).eq('id', athleteId).maybeSingle();
      if (primary.error && isMissingColumn(primary.error)) {
        const fallback = await supabase.from('athletes').select(ME_COLS_FALLBACK).eq('id', athleteId).maybeSingle();
        me = fallback.error ? null : fallback.data;
      } else {
        me = primary.error ? null : primary.data;
      }
    }
    if (!me || !me.is_academy) return NextResponse.json({ isMember: false });

    // Yesterday (1ג's row names its session) through the day after tomorrow (the evening's
    // rest card shows the day after the focus day).
    const days = [-1, 0, 1, 2].map(k => shiftDate(today, k));
    const weekStarts = [...new Set(days.map(d => planWeekStartOf(d)))];

    const [
      coaches, unread, paceUpdate, characterization, bandRes, loads, plansRes, groupsRes, laneRefs,
      deliveriesRes, nightsRes, inviteRes, actsRes,
    ] = await Promise.all([
      loadCoachRows(supabase, athleteId, me.academy_coach_id ?? null),
      loadTraineeUnread(athleteId),
      loadPaceUpdateCard(supabase, athleteId, today),
      loadGoalCharacterization(supabase, athleteId),
      me.academy_band_id
        ? supabase.from('academy_bands').select('id, band_number, name, goal, pace_profile').eq('id', me.academy_band_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // The same series /api/academy/load draws from, so the home's number IS screen 7's.
      athleteLoads(supabase, athleteId, { since: shiftDate(today, -BACKFILL_DAYS), write: !caller.viewingAsBy, today }),
      supabase
        .from('weekly_plans')
        .select('week_start_date, parsed_workouts, status, athlete_id, created_at')
        .eq('coach_id', COACH_ID)
        .or(planRowsFilter(athleteId))
        .in('week_start_date', weekStarts)
        .order('created_at', { ascending: true }),
      supabase.from('groups').select('id, name'),
      loadLaneReferences(supabase),
      supabase
        .from('workout_deliveries')
        .select('workout_date, status')
        .eq('athlete_id', athleteId)
        .gte('workout_date', days[0])
        .lte('workout_date', days[days.length - 1]),
      supabase
        .from('athlete_wellness')
        .select('date, sleep_seconds, resting_hr')
        .eq('athlete_id', athleteId)
        .gte('date', shiftDate(today, -NIGHTS))
        .lte('date', today),
      // The open invitation (migration 112; a missing table reads as none).
      supabase
        .from('academy_test_invitations')
        .select('id, athlete_id, protocol, proposed_slots, confirmed_slot, status')
        .eq('athlete_id', athleteId)
        .in('status', ['proposed', 'confirmed', 'other'])
        .order('created_at', { ascending: false })
        .limit(1),
      // Yesterday's and today's runs: today's "done", yesterday's km.
      supabase
        .from('athlete_activities')
        .select('id, start_time, distance, activity_type')
        .eq('athlete_id', athleteId)
        .gte('start_time', `${shiftDate(today, -2)}T00:00:00Z`),
    ]);

    // ── The plan days ──
    const groupNames = new Map<string, string>(((groupsRes.data || []) as Array<{ id: string; name: string }>).map(g => [g.id, g.name]));
    const tests = loads.tests;
    const onWatch = new Set(
      ((deliveriesRes.data || []) as Array<{ workout_date: string; status: string }>)
        .filter(d => d.status === 'success')
        .map(d => String(d.workout_date).slice(0, 10)),
    );
    const acts = ((actsRes.error ? [] : actsRes.data) || []) as Array<{ id: string; start_time: string; distance: number | null; activity_type: string | null }>;
    const ranOn = (date: string) => acts.some(a => isRunType(a.activity_type) && activityLocalDateStr(a.start_time) === date);
    const { cards, planWeeks } = dayCards({
      dates: days,
      athleteId,
      groupId: me.group_id ?? null,
      planRows: ((plansRes.error ? [] : plansRes.data) || []) as any[],
      groupNames,
      laneRefs,
      tests,
      onWatch,
      doneOn: date => date === today && ranOn(today),
    });

    // ── The invitation ──
    const inviteRow = inviteRes.error ? null : ((inviteRes.data || [])[0] as Record<string, unknown> | undefined) ?? null;
    const invitation: TestInvitation | null = inviteRow
      ? {
        id: String(inviteRow.id),
        athleteId,
        protocol: String(inviteRow.protocol || '30min'),
        proposedSlots: (Array.isArray(inviteRow.proposed_slots) ? inviteRow.proposed_slots : []).filter((s): s is string => typeof s === 'string'),
        confirmedSlot: typeof inviteRow.confirmed_slot === 'string' ? inviteRow.confirmed_slot : null,
        status: String(inviteRow.status || 'proposed') as TestInvitation['status'],
      }
      : null;
    const slot = invitation ? invitationSlot(invitation) : null;
    const slotMs = slot ? Date.parse(slot) : NaN;

    // ── The race ──
    const band = bandRes.data ? toBand(bandRes.data as never) : null;
    const race = todayRace({
      goal: goalCard(characterization, band, today),
      raceName: characterization?.targetRace ?? null,
      raceDate: characterization?.targetRaceDate ?? null,
      bandGoal: band?.paceProfile?.marathonGoal || band?.goal || null,
    });

    const coach = coaches.data[0] ?? null;
    const body: TraineeToday = buildTraineeToday({
      today,
      evening,
      cards,
      planWeeks,
      weekStartOf: (d) => planWeekStartOf(d),
      athlete: { id: me.id, name: me.name, gender: me.gender === 'female' || me.gender === 'male' ? me.gender : null },
      coach: coach ? { id: coach.id, name: coach.name, avatarUrl: coach.avatar_url || null } : null,
      unread,
      paceUpdate: paceUpdate.card,
      invitation,
      invitationDate: Number.isFinite(slotMs) ? israelToday(new Date(slotMs)) : null,
      hasUsableTest: tests.length > 0,
      loads: loads.rows,
      tests,
      nights: ((nightsRes.error ? [] : nightsRes.data) || []).map((n: any) => ({
        date: String(n.date).slice(0, 10), sleep_seconds: n.sleep_seconds ?? null, resting_hr: n.resting_hr ?? null,
      })),
      race,
      yesterdayTitle: cards[days[0]]?.title ?? null,
      distances: Object.fromEntries(acts.map(a => [a.id, Number(a.distance) || 0])),
    });
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error('Academy today error:', error);
    return NextResponse.json({ error: 'Failed to load today' }, { status: 500 });
  }
}
