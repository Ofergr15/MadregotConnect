import { NextResponse } from 'next/server';
import { pricingRows } from '@/lib/academy/coach-baseline';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { addDaysToDateStr, israelToday, planWeekStartOf, shiftWeekStart } from '@/lib/utils';
import { computeAcademyWeekAdherence, computeAthleteWeekHistory, sundayOf } from '@/lib/academy/report';
import { loadPlanBasis } from '@/lib/academy/book-server';
import { sessionSize } from '@/lib/academy/book-steps';
import { boardRow } from '@/lib/academy/board';
import { DISPLAY_REFERENCE } from '@/lib/academy/plan-basis';
import { testStateOf, type TestRow } from '@/lib/academy/test-state';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { toBand, bandMeaning } from '@/lib/academy/bands';
import { thresholdPaceSec } from '@/lib/academy/tests';
import { loadPaceUpdateCard } from '@/lib/academy/coach-tools-server';
import { traineePlanRow } from '@/lib/academy/me-plan-row';
import { loadCoachRows, loadGoalCharacterization, loadTraineeUnread, type GoalCharacterization } from '@/lib/academy/me-reads';
import { RACE_RESULT_WINDOW_DAYS, distanceForKind, pickRaceRun } from '@/lib/academy/goal';
import {
  goalCard,
  journeyPlanStats,
  kmAverage,
  monthsBetween,
  resolveTraineePaces,
  withPaceUpdate,
  rowPace,
  rowStatus,
  type HomeWorkout,
  type TraineeHome,
  type HomeRaceResult,
} from '@/lib/academy/trainee-home';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/me?athleteId=…&weekStart=YYYY-MM-DD
 *
 * The academy as one of its trainees sees it — the home of mockup
 * academy-trainee-home-v4: their coach, their goal, their paces, twelve weeks of
 * kilometres, this week's plan row by row, and "the journey" below the fold.
 *
 * Deliberately a separate route from /api/academy/members rather than a
 * "scope=self" flag on it: that one is staff-only and returns every member's email,
 * approval state and attention flags, and the safest way to keep a trainee out of
 * that payload is for the trainee's screen never to call it. Nothing here is about
 * anybody else any more — the leaderboard, the rank and "the academy this week"
 * were removed from the trainee's screen (2026-10-06), so this route stopped
 * reading the roster at all.
 *
 * Payload discipline: the week is graded WITH accuracy (laps read, never fetched)
 * and with the raw plan kept for today's steps, but neither the laps nor the raw
 * plan leave the server — each row is reduced to the dozen fields its line draws.
 * The full plan-vs-actual of one workout is /api/academy/workout.
 */

/** How far back "the journey" looks. A season; the tiles are about this academy stint. */
const JOURNEY_WEEKS = 52;
/** The km chart's bars, the last one being the week on screen. */
const CHART_WEEKS = 12;

const round1 = (meters: number) => Math.round(meters / 100) / 10;

/** Pre-077 schemas have no pairing columns; the screen still renders without them. */
const ME_COLS = 'id, name, gender, avatar_url, is_academy, academy_coach_id, academy_band_id, academy_pace_offset_sec, academy_joined_on';
const ME_COLS_FALLBACK = 'id, name, avatar_url, is_academy';

/**
 * Every activity since they joined, for the journey tiles — runs, kilometres and
 * the longest one. Paged because PostgREST caps a response at 1000 rows; scoped to
 * the ONE athlete whose screen this is.
 */
async function loadJourneyActivities(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  since: string | null,
): Promise<{ runs: number; meters: number; longest: number }> {
  const acc = { runs: 0, meters: 0, longest: 0 };
  for (let offset = 0; ; offset += 1000) {
    let q = supabase
      .from('athlete_activities')
      .select('distance')
      .eq('athlete_id', athleteId);
    if (since) q = q.gte('start_time', `${since}T00:00:00Z`);
    const { data: page, error } = await q.range(offset, offset + 999);
    if (error || !page || page.length === 0) break;
    for (const r of page as Array<{ distance: unknown }>) {
      const d = Number(r.distance) || 0;
      acc.runs += 1;
      acc.meters += d;
      if (d > acc.longest) acc.longest = d;
    }
    if (page.length < 1000) break;
  }
  return acc;
}

/**
 * "איך היה?" (goal module G5): the race day has passed, within three weeks, and no result
 * was recorded. The watch run that looks like the race comes along so the trainee confirms it
 * in one tap. Null in every other case, and on any read error — a prompt is optional.
 */
async function raceResultPrompt(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  c: GoalCharacterization | null,
  today: string,
): Promise<HomeRaceResult | null> {
  const date = c?.targetRaceDate;
  if (!c?.targetRace || !date || c.dateIsEstimate || c.resultSec) return null;
  const since = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
  if (!(since >= 1 && since <= RACE_RESULT_WINDOW_DAYS)) return null;
  const distanceKm = c.distanceKm ?? distanceForKind(c.goalType);
  let run = null;
  try {
    const { data } = await supabase
      .from('athlete_activities')
      .select('id, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${date}T00:00:00Z`)
      .lte('start_time', `${date}T23:59:59Z`)
      .limit(10);
    run = pickRaceRun((data || []) as Array<{ id: string; start_time: string; distance: number | null; duration: number | null }>, date, distanceKm);
  } catch { /* no run to offer — the trainee types the time */ }
  return { name: c.targetRace, raceDate: date, distanceKm, goalTimeSec: c.goalTimeSec ?? null, run };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }
    // Self-or-staff: an athlete may pull their own academy view, and a coach may
    // pull it for any athlete (that's what the member drill-in shows).
    const { denied, caller } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;
    // A coach looking at a trainee gets their phone, for the header's call and
    // WhatsApp buttons. Staff can already read it (athletes/me is self-or-staff);
    // the trainee's own home never needs it.
    const viewerIsOther = caller.athleteId !== athleteId;

    // The PLAN week (Sunday) — what the ← → arrows step through and what the coach
    // published against. Never later than this week: there is nothing to grade yet.
    const currentWeek = planWeekStartOf();
    const asked = searchParams.get('weekStart') ? sundayOf(searchParams.get('weekStart')) : currentWeek;
    const weekStart = asked > currentWeek ? currentWeek : asked;
    const today = israelToday();

    const supabase = createServerClient();

    let me: any = null;
    {
      const primary = await supabase.from('athletes').select(ME_COLS)
        .eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
      if (primary.error) {
        const fallback = await supabase.from('athletes').select(ME_COLS_FALLBACK)
          .eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
        me = fallback.error ? null : fallback.data;
      } else {
        me = primary.data;
      }
    }
    // "Not a member" is an answer, not an error — the screen renders an invite
    // to talk to the coach rather than an error state, and this way it never
    // leaks academy numbers to a club runner who isn't in it.
    if (!me || !me.is_academy) {
      return NextResponse.json({ isMember: false, weekStart } satisfies TraineeHome);
    }

    const joinedOn: string | null = me.academy_joined_on || null;
    const journeyFloor = shiftWeekStart(currentWeek, -(JOURNEY_WEEKS - 1));
    const joinedWeek = joinedOn ? sundayOf(joinedOn) : null;
    const journeyFrom = joinedWeek && joinedWeek > journeyFloor ? joinedWeek : journeyFloor;
    const chartFrom = shiftWeekStart(weekStart, -(CHART_WEEKS - 1));
    const historyFrom = chartFrom < journeyFrom ? chartFrom : journeyFrom;

    // Independent reads, side by side — each is small and the cost of this route is
    // the number of round trips it waits for, not the size of any one answer.
    const [
      settings, adherence, history, journeyActs, watch, coachRes, bandRes, characterization, tests, feedbackRes, unread, paceUpdate,
    ] = await Promise.all([
      loadAcademySettings(),
      // The same shared implementation the coach's compliance table uses, so the
      // two can't disagree about whether a session counted — with accuracy, for
      // the rings, and the raw plan kept for today's steps.
      computeAcademyWeekAdherence({ weekStart, onlyAthleteId: athleteId, keepDetail: true }),
      computeAthleteWeekHistory({ athleteId, fromWeek: historyFrom, toWeek: currentWeek }),
      loadJourneyActivities(supabase, athleteId, joinedOn),
      // Just this athlete's provider tokens, for "has a watch". `strava_auth`
      // predates some deployments, so a 42703 falls back to Garmin alone.
      supabase
        .from('athletes')
        .select('garmin_auth:has_garmin, strava_auth:has_strava')
        .eq('id', athleteId)
        .maybeSingle<{ garmin_auth: unknown; strava_auth: unknown }>()
        .then((res) => (res.error
          ? supabase.from('athletes').select('garmin_auth:has_garmin').eq('id', athleteId)
            .maybeSingle<{ garmin_auth: unknown }>()
          : res)),
      // All their coaches (a shared trainee has several), legacy first.
      loadCoachRows(supabase, athleteId, me.academy_coach_id ?? null),
      me.academy_band_id
        ? supabase.from('academy_bands').select('id, band_number, name, goal, pace_profile').eq('id', me.academy_band_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // The characterization call's answers (the three goal fields only).
      loadGoalCharacterization(supabase, athleteId),
      // The latest APPROVED, non-excluded test, for the paces fallback. Migration
      // 108's `status` may be absent; then every row counts, as everywhere else.
      supabase
        .from('academy_tests')
        .select('test_date, duration_sec, distance_m, excluded_reason, status, protocol')
        .eq('athlete_id', athleteId)
        .order('test_date', { ascending: false })
        .limit(10)
        .then((res) => (res.error
          ? supabase.from('academy_tests')
            .select('test_date, duration_sec, distance_m, excluded_reason, protocol')
            .eq('athlete_id', athleteId)
            .order('test_date', { ascending: false })
            .limit(10)
          : res)),
      // Which days of the week the mentor reviewed — the 💬 chip.
      supabase
        .from('academy_workout_feedback')
        .select('workout_date')
        .eq('athlete_id', athleteId)
        .gte('workout_date', weekStart)
        .lte('workout_date', addDaysToDateStr(weekStart, 6)),
      // The red dot. Never throws and never waits more than 1.5 s.
      loadTraineeUnread(athleteId),
      // The coach's pace update (migration 141): the card, and the paces it moved.
      loadPaceUpdateCard(supabase, athleteId, today),
    ]);

    const tolerances = settings.tolerances;
    const band = bandRes.data ? toBand(bandRes.data as never) : null;
    const coachRows = (coachRes.data || []) as Array<{ id: string; name: string; avatar_url: string | null }>;
    const coach = coachRows[0] ?? null;
    const feedbackDays = new Set(
      ((feedbackRes as { data: Array<{ workout_date: string }> | null }).data || []).map((r) => r.workout_date),
    );

    // 30-minute tests only, as every other pace and ⚡ (load-server loadTestsFor,
    // book-server loadThresholds): a 2000 m test's pace is far above threshold, and
    // standing in for it would make this screen's paces faster than the board's.
    // …or, without one, the coach's baseline (coach-baseline.ts pricingRows: the shared precedence).
    const latestTest = pricingRows((((tests as { data: any[] | null }).data) || []).map((t) => ({ ...t, athlete_id: athleteId })))[0];
    const testThreshold = latestTest
      ? thresholdPaceSec({ durationSec: Number(latestTest.duration_sec), distanceM: Number(latestTest.distance_m) })
      : null;

    // ── This week, row by row ──
    const rows = adherence.athletes[0]?.week.workouts ?? [];
    // Sized exactly as the week board sizes them (book-steps sessionSize at the plan's pace
    // basis, the trainee's own threshold), so "השבוע 18.3 מתוך 65.8" here is the board's
    // "מתוך 66" — and an optional session or a day before joining is not planned km.
    const sizeT = testThreshold ? Math.round(testThreshold) : null;
    const basis = rows.length ? await loadPlanBasis(supabase, athleteId, weekStart, sizeT).catch(() => null) : null;
    const referenceSec = basis?.referenceSec ?? sizeT ?? DISPLAY_REFERENCE;
    const sized = rows.map(w => boardRow(w, today, sessionSize(w.detail?.workout.steps, referenceSec, basis?.drawAtSec ?? referenceSec), {
      optional: !!w.detail?.workout.optional, joinedOn,
    }));
    const workouts: HomeWorkout[] = rows.map((w, i) => {
      const plannedM = Math.round(sized[i].plannedM ?? (w.distance.plannedMin + w.distance.plannedMax) / 2);
      // In the trainee's own terms: the club week's lane paces restated to their
      // threshold (none without one), and the session's name, not the weekday's.
      const mine = traineePlanRow({
        name: w.name,
        workout: w.detail?.workout,
        plannedMin: w.pace.comparedMin ?? w.pace.plannedMin,
        plannedMax: w.pace.comparedMax ?? w.pace.plannedMax,
        comparedMin: w.pace.comparedMin,
        comparedMax: w.pace.comparedMax,
        basis: basis ?? { scale: 1, referenceSec },
        thresholdSec: sizeT,
      });
      const out: HomeWorkout = {
        date: w.date,
        name: mine.name,
        status: rowStatus({
          date: w.date,
          today,
          completed: w.completed,
          distanceStatus: w.distance.status,
          distancePct: w.distance.pct,
          score: w.execution?.score ?? null,
        }),
        plannedM,
        actualM: w.distance.actual,
        plannedDurationSec: sized[i].plannedSec ?? (w.duration.planned > 0 ? w.duration.planned : null),
        pace: w.completed
          ? rowPace({
            averagePace: w.pace.actual,
            comparedMin: mine.comparedMin,
            comparedMax: mine.comparedMax,
            workPace: sizeT && w.workPace
              ? { ...w.workPace, min: Math.round(w.workPace.min * (basis?.scale ?? 1)), max: Math.round(w.workPace.max * (basis?.scale ?? 1)) }
              : null,
            toleranceSec: tolerances.paceSec,
          })
          : null,
        plannedPace: mine.plannedPace,
        hasFeedback: feedbackDays.has(w.date),
      };
      if (w.date === today && mine.tiles) out.steps = mine.tiles;
      return out;
    });
    const plannedKm = round1(workouts.reduce((sum, w, i) => (sized[i].excuse === 'optional' || sized[i].excuse === 'beforeJoin' ? sum : sum + w.plannedM), 0));

    // ── The km chart: twelve plan weeks ending at the week on screen ──
    const chartWeeks = history
      .filter((h) => h.weekStart >= chartFrom && h.weekStart <= weekStart)
      // plannedKm per week too: the coach's trainee header draws done against planned.
      .map((h) => ({ weekStart: h.weekStart, km: round1(h.ranM), plannedKm: round1(h.plannedM) }));

    // ── The journey ──
    const journeyWeeks = history.filter((h) => h.weekStart >= journeyFrom);
    const { planPct, streakWeeks } = journeyPlanStats(journeyWeeks, currentWeek);

    const phone = viewerIsOther
      ? ((await supabase.from('athletes').select('phone').eq('id', athleteId).maybeSingle<{ phone: string | null }>()).data?.phone ?? null)
      : undefined;

    const hasWatch = !!(watch.data as { garmin_auth?: unknown } | null)?.garmin_auth
      || !!(watch.data as { strava_auth?: unknown } | null)?.strava_auth;

    const body: TraineeHome = {
      isMember: true,
      weekStart,
      test: testStateOf((((tests as { data: any[] | null }).data) || []) as TestRow[], today),
      athlete: {
        athleteId: me.id, name: me.name, avatarUrl: me.avatar_url || null, hasWatch,
        gender: me.gender === 'female' || me.gender === 'male' ? me.gender : null,
        ...(phone !== undefined ? { phone } : {}),
      },
      coach: coach ? { id: coach.id, name: coach.name, avatarUrl: coach.avatar_url || null } : null,
      coaches: coachRows.map((c) => ({ id: c.id, name: c.name, avatarUrl: c.avatar_url || null })),
      unread,
      goal: goalCard(characterization, band, today),
      raceResult: await raceResultPrompt(supabase, athleteId, characterization, today),
      paces: withPaceUpdate(resolveTraineePaces({
        band,
        athleteOffsetSec: typeof me.academy_pace_offset_sec === 'number' ? me.academy_pace_offset_sec : null,
        testThresholdSec: testThreshold,
      }), paceUpdate.adjust),
      paceUpdate: paceUpdate.card,
      bandMeaning: bandMeaning(band),
      km: { weeks: chartWeeks, plannedKm, avgKm: kmAverage(chartWeeks) },
      week: {
        // The engine's counts, as the board's: an optional session is not planned.
        plannedCount: adherence.athletes[0]?.week.plannedCount ?? rows.length,
        completedCount: adherence.athletes[0]?.week.completedCount ?? rows.filter((w) => w.completed).length,
        workouts,
      },
      journey: {
        monthsWithUs: monthsBetween(joinedOn, today),
        runs: journeyActs.runs,
        km: Math.round(journeyActs.meters / 1000),
        planPct,
        streakWeeks,
        longestKm: journeyActs.longest > 0 ? round1(journeyActs.longest) : null,
      },
    };
    return NextResponse.json(body);
  } catch (error: any) {
    console.error('Academy me error:', error);
    return NextResponse.json({ error: error.message || 'Failed to load academy view' }, { status: 500 });
  }
}
