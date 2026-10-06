import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { addDaysToDateStr, israelToday, planWeekStartOf, shiftWeekStart } from '@/lib/utils';
import { computeAcademyWeekAdherence, computeAthleteWeekHistory, sundayOf } from '@/lib/academy/report';
import { loadAcademySettings } from '@/lib/academy/settings-server';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';
import { readCharacterization } from '@/lib/academy/characterization';
import { toBand } from '@/lib/academy/bands';
import { thresholdPaceSec } from '@/lib/academy/tests';
import { traineeUnreadCount } from '@/lib/academy/thread-server';
import { getStreamServerClient } from '@/lib/stream/server';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import {
  goalCard,
  journeyPlanStats,
  kmAverage,
  monthsBetween,
  plannedPaceOf,
  resolveTraineePaces,
  rowPace,
  rowStatus,
  stepTiles,
  type HomeWorkout,
  type TraineeHome,
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
const ME_COLS = 'id, name, avatar_url, is_academy, academy_coach_id, academy_band_id, academy_pace_offset_sec, academy_joined_on';
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }
    // Self-or-staff: an athlete may pull their own academy view, and a coach may
    // pull it for any athlete (that's what the member drill-in shows).
    const { denied } = await requireCallerForAthlete(request, athleteId);
    if (denied) return denied;

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
      settings, adherence, history, journeyActs, watch, coachRes, bandRes, characterization, tests, feedbackRes, unread,
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
        .select('garmin_auth, strava_auth')
        .eq('id', athleteId)
        .maybeSingle<{ garmin_auth: unknown; strava_auth: unknown }>()
        .then((res) => (res.error
          ? supabase.from('athletes').select('garmin_auth').eq('id', athleteId)
            .maybeSingle<{ garmin_auth: unknown }>()
          : res)),
      // All their coaches (a shared trainee has several), legacy first.
      (async () => {
        const ids = await coachIdsOf(supabase, athleteId, me.academy_coach_id ?? null);
        if (!ids.length) return { data: [] as Array<{ id: string; name: string; avatar_url: string | null }>, error: null };
        const { data, error } = await supabase.from('athletes').select('id, name, avatar_url').in('id', ids);
        const rows = (error ? [] : (data || [])) as Array<{ id: string; name: string; avatar_url: string | null }>;
        const byId = new Map(rows.map((r) => [r.id, r]));
        return { data: ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r), error: null };
      })(),
      me.academy_band_id
        ? supabase.from('academy_bands').select('id, band_number, name, goal, pace_profile').eq('id', me.academy_band_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // The characterization call's answers, through the candidate row that became
      // this athlete. Only the three goal fields — never the coach's verdict or the
      // limitations note, which the goal card has no use for.
      (async () => {
        const { data: cands, error } = await supabase
          .from('academy_candidates')
          .select('id')
          .eq('athlete_id', athleteId);
        if (error || !cands?.length) return null;
        const { data: rows, error: cErr } = await supabase
          .from('academy_characterizations')
          .select('candidate_id, goal_type, target_race, target_race_date')
          .in('candidate_id', cands.map((c: { id: string }) => c.id));
        if (cErr || !rows?.length) return null;
        // More than one candidate row for a person is a re-application; the one with
        // a race named is the one that says what they are training for now.
        const read = rows.map((r) => readCharacterization(r as Record<string, unknown>));
        return read.find((c) => c.targetRace) ?? read.find((c) => c.goalType) ?? null;
      })(),
      // The latest APPROVED, non-excluded test, for the paces fallback. Migration
      // 108's `status` may be absent; then every row counts, as everywhere else.
      supabase
        .from('academy_tests')
        .select('test_date, duration_sec, distance_m, excluded_reason, status')
        .eq('athlete_id', athleteId)
        .order('test_date', { ascending: false })
        .limit(10)
        .then((res) => (res.error
          ? supabase.from('academy_tests')
            .select('test_date, duration_sec, distance_m, excluded_reason')
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
      (async () => {
        try { return await traineeUnreadCount(getStreamServerClient(), athleteId); } catch { return 0; }
      })(),
    ]);

    const tolerances = settings.tolerances;
    const band = bandRes.data ? toBand(bandRes.data as never) : null;
    const coachRows = (coachRes.data || []) as Array<{ id: string; name: string; avatar_url: string | null }>;
    const coach = coachRows[0] ?? null;
    const feedbackDays = new Set(
      ((feedbackRes as { data: Array<{ workout_date: string }> | null }).data || []).map((r) => r.workout_date),
    );

    const latestTest = (((tests as { data: any[] | null }).data) || [])
      .filter((t) => !t.excluded_reason && (t.status ?? 'approved') === 'approved')[0];
    const testThreshold = latestTest
      ? thresholdPaceSec({ durationSec: Number(latestTest.duration_sec), distanceM: Number(latestTest.distance_m) })
      : null;

    // ── This week, row by row ──
    const rows = adherence.athletes[0]?.week.workouts ?? [];
    const workouts: HomeWorkout[] = rows.map((w) => {
      const plannedM = Math.round((w.distance.plannedMin + w.distance.plannedMax) / 2);
      const out: HomeWorkout = {
        date: w.date,
        name: w.name,
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
        plannedDurationSec: w.duration.planned > 0 ? w.duration.planned : null,
        pace: w.completed
          ? rowPace({
            averagePace: w.pace.actual,
            comparedMin: w.pace.comparedMin,
            comparedMax: w.pace.comparedMax,
            workPace: w.workPace ?? null,
            toleranceSec: tolerances.paceSec,
          })
          : null,
        plannedPace: plannedPaceOf(w.pace.comparedMin ?? w.pace.plannedMin, w.pace.comparedMax ?? w.pace.plannedMax),
        hasFeedback: feedbackDays.has(w.date),
      };
      if (w.date === today && w.detail?.workout) out.steps = stepTiles(w.detail.workout);
      return out;
    });
    const plannedKm = round1(workouts.reduce((sum, w) => sum + w.plannedM, 0));

    // ── The km chart: twelve plan weeks ending at the week on screen ──
    const chartWeeks = history
      .filter((h) => h.weekStart >= chartFrom && h.weekStart <= weekStart)
      .map((h) => ({ weekStart: h.weekStart, km: round1(h.ranM) }));

    // ── The journey ──
    const journeyWeeks = history.filter((h) => h.weekStart >= journeyFrom);
    const { planPct, streakWeeks } = journeyPlanStats(journeyWeeks, currentWeek);

    const hasWatch = !!(watch.data as { garmin_auth?: unknown } | null)?.garmin_auth
      || !!(watch.data as { strava_auth?: unknown } | null)?.strava_auth;

    const body: TraineeHome = {
      isMember: true,
      weekStart,
      athlete: { athleteId: me.id, name: me.name, avatarUrl: me.avatar_url || null, hasWatch },
      coach: coach ? { id: coach.id, name: coach.name, avatarUrl: coach.avatar_url || null } : null,
      coaches: coachRows.map((c) => ({ id: c.id, name: c.name, avatarUrl: c.avatar_url || null })),
      unread,
      goal: goalCard(characterization, band, today),
      paces: resolveTraineePaces({
        band,
        athleteOffsetSec: typeof me.academy_pace_offset_sec === 'number' ? me.academy_pace_offset_sec : null,
        testThresholdSec: testThreshold,
      }),
      km: { weeks: chartWeeks, plannedKm, avgKm: kmAverage(chartWeeks) },
      week: {
        plannedCount: rows.length,
        completedCount: rows.filter((w) => w.completed).length,
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
