import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireSession, authError } from '@/lib/auth-session';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { computeChallengeProgress, type ChallengeRow } from '@/lib/challenges/engine';
import { planWeekTarget } from '@/lib/feed/plan-week-target';
import { groupNumberForAthlete } from '@/lib/plans/match-athlete-activities';
import type { Lane } from '@/lib/academy/group-lane';
import {
  buildHighlight,
  dayKeyDiff,
  WEEK_DAYS,
  type FeedHighlight,
  type HighlightChallenge,
} from '@/lib/feed/highlight';
import {
  activityLocalDateStr,
  addDaysToDateStr,
  planWeekStartOf,
  israelToday,
} from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed/highlight
 *
 * The card pinned above the feed: this week's kilometres against the week's target,
 * and the active challenge with whether the athlete has finished it. `buildHighlight`
 * owns what gets said; this route only gathers what that needs.
 *
 * ── Where the numbers come from ──────────────────────────────────────────────
 * Both come from this app's own `athlete_activities`, NOT from Strava's or Garmin's
 * API. That is the right source and not a shortcut:
 *  - Both syncs write into the same table, so a Garmin-only member and a
 *    Strava-only member are counted identically. Asking one provider directly would
 *    silently zero out everyone on the other.
 *  - `hasCrossSourceDuplicate` in the Strava sync already de-duplicates a run that
 *    Garmin auto-exported to Strava, so a run counts once. Two API reads would
 *    count it twice.
 *  - `filterQualifyingRuns` is the same filter PRs, badges and challenges use, so
 *    this card cannot disagree with the challenge screen.
 * Where a run exists in both, the Garmin row is the one kept — it is the primary
 * integration and the richer record (laps, HR, cadence).
 *
 * ── Which week ───────────────────────────────────────────────────────────────
 * One: the PLAN week (`planWeekStartOf`, Sunday–Saturday in Israel), for the
 * kilometres, the day strip, the dismiss key and the target alike — the window
 * `weekly_plans.week_start_date` is keyed on and the profile ring already uses.
 * Until 2026-11-17 the km half was cut on `athletes.week_start_day` (Monday by
 * default), so the card's label disagreed with the plan's by a day (QA #3).
 * Deliberately not `getDisplayWeekStart`, which rolls to next week after Saturday
 * 20:00: the dashboard does that so a runner can preview the coming plan, but this
 * card answers "how is my week going", and on Saturday evening that is still the
 * week they are standing in.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * There is deliberately NO `athleteId` parameter. The athlete is whoever the
 * Supabase JWT says it is, so this route has no IDOR surface to get wrong.
 *
 * ── Why the challenge half is safe to ship ────────────────────────────────────
 * A progress card frozen at zero would be worse than no card, and challenge
 * evaluation used to run only inside the Strava sync — so a Garmin-only member never
 * moved. Both syncs now call `checkAndAwardChallenges`, and the number here is
 * `computeChallengeProgress`, which recomputes from `athlete_activities` on read
 * rather than trusting a stored counter.
 *
 * Note there is still no notion of *joining* a challenge: rows in `challenges` apply
 * to every athlete in scope automatically. So this reports on a challenge that is
 * running, not one they opted into. Flagged, not built.
 */

/** Columns needed for the run filter plus the kilometres derived here. */
interface ActivityRow extends RunActivityRow {
  start_time: string;
  distance: number;
  duration: number;
}

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  // Staff without an athlete row have no training week to report on. 200 with a
  // null highlight, not 403: the feed renders fine without this card and a coach
  // opening the feed is not an error.
  if (!auth.user.athleteId) return NextResponse.json({ highlight: null });

  const athleteId = auth.user.athleteId;

  try {
    const supabase = createServerClient();
    const now = new Date();
    const todayKey = israelToday(now);
    // ONE window for the whole card: the PLAN week (Sunday–Saturday, Israel), the
    // same `planWeekStartOf` the plan, the profile ring (lib/athletes/plan-week) and
    // `weekly_plans.week_start_date` use. QA 2026-11-17 #3: this card used to cut
    // its km on the athlete's activity week (Monday by default) while measuring it
    // against the Sunday plan's target, so the feed read "16-22 November" above a
    // plan reading "15-21 November" and the km and the target covered different days.
    const planWeek = planWeekStartOf(now);
    // The target and the challenge need neither the week preference nor the runs,
    // so they go out now and are collected below: two function↔DB round trips
    // instead of four on a card the feed shows on open. The extra handler only
    // keeps a rejection from being reported as unhandled while the runs load; the
    // await below still throws it.
    const sideReads = Promise.all([
      resolveWeekTarget(supabase, athleteId, planWeek),
      resolveChallenge(supabase, athleteId, todayKey),
    ]);
    sideReads.catch(() => {});
    const weekStart = planWeek;
    const daysElapsed = dayKeyDiff(weekStart, todayKey) + 1;

    // Only this week's rows, because this week is all the card uses.
    //
    // This read used to be the athlete's ENTIRE history, unbounded — and PostgREST
    // caps a response at 1000 rows without telling you. Fourteen of the club's
    // athletes are past that cap (Itai 3,878, Roy 2,895), so the read was silently
    // truncated for most of them. It happened to still be *correct*, because
    // `order desc` meant the surviving thousand was always the newest thousand and
    // this week was always inside it — but that is an accident of two clauses, not a
    // property of the code, and it was fetching ~1000 rows to use about five on the
    // landing page's critical path.
    //
    // Two ways the accident could end: 26 rows in prod already carry a FUTURE
    // start_time, and Postgres sorts NULLs first under DESC — so an athlete
    // accumulating a thousand future-dated or null-dated rows would push this week
    // out of the window entirely and the card would read 0.0 km after a full week of
    // running. And any future all-time stat added to this card would silently read a
    // last-1000 window.
    //
    // Bounded a day either side of the week: `activityLocalDateStr` below stays the
    // authority on which day a run belongs to, and start_time holds local wall clock
    // (Convention A), so the pad keeps this filter a strict superset of what the loop
    // keeps rather than a second, competing definition of the week.
    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .gte('start_time', addDaysToDateStr(weekStart, -1))
      .lt('start_time', addDaysToDateStr(weekStart, WEEK_DAYS + 1))
      .order('start_time', { ascending: false });
    if (error) throw error;

    const runs = filterQualifyingRuns((acts || []) as ActivityRow[]);

    // This week's kilometres, per day, from `weekStart` (the plan's Sunday). Read as the athlete's local
    // day — these timestamps are wall-clock-stored-as-UTC (see lib/utils.ts).
    const dailyKm = new Array<number>(WEEK_DAYS).fill(0);
    for (const r of runs) {
      const offset = dayKeyDiff(weekStart, activityLocalDateStr(r.start_time));
      if (offset < 0 || offset >= WEEK_DAYS) continue;
      dailyKm[offset] += r.distance / 1000;
    }
    const weekKm = dailyKm.reduce((a, b) => a + b, 0);

    const [{ targetMin, targetMax }, challenge] = await sideReads;

    const highlight: FeedHighlight | null = buildHighlight({
      weekStart,
      weekKm,
      weekTargetMin: targetMin,
      weekTargetMax: targetMax,
      weekDailyKm: dailyKm,
      daysElapsed,
      challenge,
    });

    return NextResponse.json({ highlight });
  } catch (err: unknown) {
    console.error('Feed highlight error:', err);
    // This card sits on the app's landing page — a failure here must not be the
    // reason the feed shows an error state.
    return NextResponse.json({ highlight: null });
  }
}

/**
 * The week's planned kilometres for this athlete: their own academy plan when they
 * have one, otherwise the club plan.
 *
 * Same precedence as /api/academy/segments — an academy runner on an individual
 * plan must be measured against that plan and not against the group's.
 *
 * The club week is read in the member's own lane and as the same floor–ceiling band
 * as the profile ring (`planWeekTarget`). Lanes share distances only for km-written
 * sessions; a timed session priced at a slower lane's pace is fewer km.
 *
 * Returns 0/0 rather than throwing when no plan covers the week — a member's first
 * week, or a week the coach hasn't published yet. The card then shows kilometres
 * with no target, which is honest.
 */
async function resolveWeekTarget(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  weekStart: string,
): Promise<{ targetMin: number; targetMax: number }> {
  const none = { targetMin: 0, targetMax: 0 };

  const pick = async (own: boolean) => {
    let query = supabase
      .from('weekly_plans')
      .select('parsed_workouts, status')
      .eq('week_start_date', weekStart);
    query = own ? query.eq('athlete_id', athleteId) : query.eq('coach_id', COACH_ID).is('athlete_id', null);
    const { data, error } = await query;
    if (error || !data?.length) return null;
    // Several drafts can exist for one week; the pushed one is what the athlete's
    // watch actually got, so it's the one to measure against.
    return data.find((p) => p.status === 'pushed') ?? data[0];
  };

  try {
    // Both asked at once; the athlete's own week still wins over the club's.
    const [own, club] = await Promise.all([pick(true), pick(false)]);
    const plan = own ?? club;
    if (!plan) return none;
    // The club week is read in the member's own pace lane, like the profile ring.
    const lane = own ? null : ((await groupNumberForAthlete(supabase, athleteId, weekStart).catch(() => 1)) as Lane);
    return planWeekTarget(plan.parsed_workouts, lane);
  } catch {
    // A plan that fails to parse must not take the whole card down with it.
    return none;
  }
}

/**
 * The most urgent active challenge, with live progress and whether it's done.
 *
 * Soonest end date wins: of two running challenges, the one about to close is the
 * one still worth acting on. Completed ones are no longer skipped — "did I finish
 * it?" is the question this half of the card exists to answer.
 */
async function resolveChallenge(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  todayKey: string,
): Promise<HighlightChallenge | null> {
  const { data: rows, error } = await supabase
    .from('challenges')
    .select('id, badge_id, name_he, name_en, metric, target_value, scope, start_date, end_date')
    .eq('active', true)
    .lte('start_date', todayKey)
    .gte('end_date', todayKey)
    .order('end_date', { ascending: true });
  // migration 062 may not be applied in this environment — no challenge, not a 500.
  if (error) return null;

  const catalog = (rows || []) as ChallengeRow[];
  const current = catalog[0];
  if (!current) return null;

  const [{ data: awards }, { data: badgeRows }] = await Promise.all([
    supabase
      .from('athlete_badges')
      .select('badge_id')
      .eq('athlete_id', athleteId)
      .eq('badge_id', current.badge_id),
    supabase.from('badges').select('id, icon, icon_url').eq('id', current.badge_id),
  ]);
  const badge = ((badgeRows || []) as Array<{ icon: string; icon_url: string | null }>)[0];

  const progress = await computeChallengeProgress(supabase, athleteId, current);
  const daysLeft = Math.max(0, dayKeyDiff(todayKey, current.end_date));

  // On track = at least as far through the target as through the calendar. One word
  // of copy, and deliberately not a projection: this card does not predict.
  const totalDays = Math.max(1, dayKeyDiff(current.start_date, current.end_date) + 1);
  const elapsedDays = Math.min(totalDays, dayKeyDiff(current.start_date, todayKey) + 1);
  const onTrack =
    current.target_value <= 0 || progress / current.target_value >= elapsedDays / totalDays;

  return {
    id: current.id,
    nameHe: current.name_he,
    nameEn: current.name_en,
    icon: badge?.icon || '🏆',
    iconUrl: badge?.icon_url || null,
    metric: current.metric,
    current: Math.round(progress * 10) / 10,
    target: current.target_value,
    daysLeft,
    // The awarded badge, not `progress >= target`: the badge is what the athlete
    // was actually given, and it is what the challenge screen and the achievement
    // card in the feed already agree on.
    done: !!awards?.length,
    onTrack,
  };
}
