import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { requireSession, authError } from '@/lib/auth-session';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { computeChallengeProgress, type ChallengeRow } from '@/lib/challenges/engine';
import { buildWeekBreakdown } from '@/lib/plans/workout-parsing';
import {
  buildHighlight,
  dayKeyDiff,
  WEEK_DAYS,
  type FeedHighlight,
  type HighlightChallenge,
} from '@/lib/feed/highlight';
import {
  activityLocalDateStr,
  getPlanWeekStart,
  israelDateAnchor,
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
 * The PLAN week (`getPlanWeekStart`, Sunday-based), because the target being
 * compared against is `weekly_plans.week_start_date` and comparing kilometres from
 * one window against a target from another is how this card would start lying.
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
    const weekStart = getPlanWeekStart(israelDateAnchor(now));
    const daysElapsed = dayKeyDiff(weekStart, todayKey) + 1;

    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false });
    if (error) throw error;

    const runs = filterQualifyingRuns((acts || []) as ActivityRow[]);

    // This week's kilometres, per day, Sunday first. Read as the athlete's local
    // day — these timestamps are wall-clock-stored-as-UTC (see lib/utils.ts).
    const dailyKm = new Array<number>(WEEK_DAYS).fill(0);
    for (const r of runs) {
      const offset = dayKeyDiff(weekStart, activityLocalDateStr(r.start_time));
      if (offset < 0 || offset >= WEEK_DAYS) continue;
      dailyKm[offset] += r.distance / 1000;
    }
    const weekKm = dailyKm.reduce((a, b) => a + b, 0);

    const [{ targetMin, targetMax }, challenge] = await Promise.all([
      resolveWeekTarget(supabase, athleteId, weekStart),
      resolveChallenge(supabase, athleteId, todayKey),
    ]);

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
 * The distance is taken from group 1's column when the plan is written per group.
 * Across the three groups a week's *distances* are the same and only the *paces*
 * differ (that's the whole point of the `3:30 (3:40) ((3:50))` notation), so this
 * is the shared number rather than group 1's number.
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
    const plan = (await pick(true)) ?? (await pick(false));
    if (!plan) return none;
    const { weekTotalMin, weekTotalMax } = buildWeekBreakdown(plan.parsed_workouts);
    return { targetMin: weekTotalMin, targetMax: weekTotalMax };
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
