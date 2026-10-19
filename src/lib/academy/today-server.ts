import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { activityLocalDateStr, israelNow, israelToday, planWeekStartOf } from '@/lib/utils';
import { planRowsFilter } from '@/lib/plans/scope';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { toBand } from './bands';
import { loadPaceUpdateCard } from './coach-tools-server';
import { loadLaneReferences } from './book-server';
import { dayCards, watchDates } from './day-cards';
import { goalCard } from './trainee-home';
import { goalTimeText } from './goal';
import { isRunType, shiftDate } from './load';
import { athleteLoads, BACKFILL_DAYS } from './load-server';
import { loadCoachRows, loadGoalCharacterization, loadTraineeUnread } from './me-reads';
import type { TestInvitation } from './testInvite';
import { loadAthleteFeeds, type AthleteFeeds } from './data-feed-server';
import { loadTestState, type TestState } from './test-state';
import {
  buildTraineeToday, EVENING_LOOKAHEAD_HOUR, invitationSlot, todayRace, type TraineeToday,
} from './trainee-today';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** The mornings the ranges are read over: 30 before the newest, plus the newest. */
const NIGHTS = 31;

const ME_COLS = 'id, name, gender, group_id, is_academy, academy_coach_id, academy_band_id';
const ME_COLS_FALLBACK = 'id, name, group_id, is_academy';

/** What the home was built from, for a caller that needs more than the payload (the data-coverage check). */
export interface TodayParts {
  loads: Awaited<ReturnType<typeof athleteLoads>>;
  feeds: AthleteFeeds;
  testState: TestState;
}

/**
 * The academy trainee's home, read and decided: GET /api/academy/today's whole body after
 * its auth gate, and GET /api/admin/trainee-data-coverage's "what will they see on 1", so
 * the check reads exactly what the screen reads and can never drift from it.
 *
 * `write`: price runs that have no stored load yet (migration 142); off under view-as and
 * for the coverage check. `unread: false` skips the Stream unread count. `inMemoryLoads`
 * prices every run in memory (load-server `athleteLoads`), never pending, never stored.
 */
export async function loadTraineeToday(
  supabase: Db,
  athleteId: string,
  opts: { write: boolean; now?: Date; unread?: boolean; inMemoryLoads?: boolean },
): Promise<{ payload: TraineeToday | { isMember: false }; parts: TodayParts | null }> {
  const now = opts.now ?? new Date();
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
  if (!me || !me.is_academy) return { payload: { isMember: false }, parts: null };

  // Yesterday (1ג's row names its session) through the day after tomorrow (the evening's
  // rest card shows the day after the focus day).
  const days = [-1, 0, 1, 2].map(k => shiftDate(today, k));
  const weekStarts = [...new Set(days.map(d => planWeekStartOf(d)))];

  const [
    coaches, unread, paceUpdate, characterization, bandRes, loads, plansRes, groupsRes, laneRefs,
    deliveriesRes, nightsRes, inviteRes, actsRes, feeds, testState,
  ] = await Promise.all([
    loadCoachRows(supabase, athleteId, me.academy_coach_id ?? null),
    opts.unread === false ? Promise.resolve(0) : loadTraineeUnread(athleteId),
    loadPaceUpdateCard(supabase, athleteId, today),
    loadGoalCharacterization(supabase, athleteId),
    me.academy_band_id
      ? supabase.from('academy_bands').select('id, band_number, name, goal, pace_profile').eq('id', me.academy_band_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // The same series /api/academy/load draws from, so the home's number IS screen 7's.
    athleteLoads(supabase, athleteId, { since: shiftDate(today, -BACKFILL_DAYS), write: opts.write && !opts.inMemoryLoads, today, inMemory: opts.inMemoryLoads }),
    supabase
      .from('weekly_plans')
      .select('id, week_start_date, parsed_workouts, status, athlete_id, created_at')
      .eq('coach_id', COACH_ID)
      .or(planRowsFilter(athleteId))
      .in('week_start_date', weekStarts)
      .order('created_at', { ascending: true }),
    supabase.from('groups').select('id, name'),
    loadLaneReferences(supabase),
    supabase
      .from('workout_deliveries')
      .select('workout_date, status, plan_id, workout_key')
      .eq('athlete_id', athleteId)
      .gte('workout_date', days[0])
      .lte('workout_date', days[days.length - 1]),
    supabase
      .from('athlete_wellness')
      .select('date, sleep_seconds, resting_hr, fetched_at')
      .eq('athlete_id', athleteId)
      .gte('date', shiftDate(today, -NIGHTS))
      .lte('date', today)
      .then(res => (res.error && isMissingColumn(res.error)
        ? supabase.from('athlete_wellness').select('date, sleep_seconds, resting_hr').eq('athlete_id', athleteId)
          .gte('date', shiftDate(today, -NIGHTS)).lte('date', today)
        : res)),
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
      .select('id, start_time, distance, activity_type, average_hr')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${shiftDate(today, -2)}T00:00:00Z`),
    // Whether runs and nights still arrive, and whether a workout can reach the watch.
    loadAthleteFeeds(supabase, athleteId, now.getTime()),
    // Every test, every protocol and status: "צריך טסט", "ממתין לאישור", "טסט ישן".
    loadTestState(supabase, athleteId, today),
  ]);

  // ── The plan days ──
  const groupNames = new Map<string, string>(((groupsRes.data || []) as Array<{ id: string; name: string }>).map(g => [g.id, g.name]));
  const tests = loads.tests;
  // An academy-only trainee (no club group) is never handed the CLUB week as theirs —
  // only their own rows; with none, the day is "no plan" and the home says the coach will
  // write it (academy-dash.html). The watch rule below reads the same rows, so a club
  // delivery can't mark their day "on the watch" either.
  const planRows = (((plansRes.error ? [] : plansRes.data) || []) as any[])
    .filter(r => me.group_id != null || r.athlete_id === athleteId);
  // Only deliveries of the workout the card shows (day-cards.ts watchDates).
  const onWatch = watchDates({
    dates: days,
    athleteId,
    planRows,
    deliveries: (deliveriesRes.data || []) as Array<{ workout_date: string; status: string; plan_id?: string | null; workout_key?: string | null }>,
    weekStartOf: planWeekStartOf,
  });
  const acts = ((actsRes.error ? [] : actsRes.data) || []) as Array<{ id: string; start_time: string; distance: number | null; activity_type: string | null; average_hr?: number | null }>;
  const ranOn = (date: string) => acts.some(a => isRunType(a.activity_type) && activityLocalDateStr(a.start_time) === date);
  const { cards, planWeeks } = dayCards({
    dates: days,
    athleteId,
    groupId: me.group_id ?? null,
    planRows,
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
    // The trainee's own goal time (migration 144) before the band's.
    bandGoal: (characterization?.goalTimeSec ? goalTimeText(characterization.goalTimeSec) : null) || band?.paceProfile?.marathonGoal || band?.goal || null,
  });

  const coach = coaches.data[0] ?? null;
  const payload: TraineeToday = buildTraineeToday({
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
    test: testState,
    feed: { run: feeds.run, night: feeds.night },
    canWatch: feeds.canWatch,
    pending: loads.pending,
    loads: loads.rows,
    tests,
    nights: ((nightsRes.error ? [] : nightsRes.data) || []).map((n: any) => ({
      date: String(n.date).slice(0, 10), sleep_seconds: n.sleep_seconds ?? null, resting_hr: n.resting_hr ?? null, fetched_at: n.fetched_at ?? null,
    })),
    race,
    yesterdayTitle: cards[days[0]]?.title ?? null,
    distances: Object.fromEntries(acts.map(a => [a.id, Number(a.distance) || 0])),
    avgHr: Object.fromEntries(acts.map(a => [a.id, Number(a.average_hr) > 0 ? Number(a.average_hr) : null])),
  });  return { payload, parts: { loads, feeds, testState } };
}
