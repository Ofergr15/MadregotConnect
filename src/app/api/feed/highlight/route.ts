import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession, authError } from '@/lib/auth-session';
import { filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { computeChallengeProgress, type ChallengeRow } from '@/lib/challenges/engine';
import {
  pickHighlight,
  shiftDayKey,
  dayKeyDiff,
  VOLUME_TREND_WEEKS,
  type FeedHighlight,
  type HighlightChallenge,
} from '@/lib/feed/highlight';
import {
  activityLocalDateStr,
  activityWeekStart,
  getActivityWeekStart,
  computeWeekStreak,
  israelDateAnchor,
  israelToday,
} from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed/highlight
 *
 * The one card pinned above the feed: an active challenge's progress, or the
 * athlete's own consistency number when no challenge is running. `pickHighlight`
 * owns the choice; this route only gathers what that needs.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * There is deliberately NO `athleteId` parameter. The athlete is whoever the
 * Supabase JWT says it is, so this route has no IDOR surface to get wrong — it
 * cannot be pointed at another member even by a caller who tries. Everything it
 * returns is the caller's own training history, which is also why it doesn't need
 * the self-or-staff dance the /api/athletes/* routes do.
 *
 * ── Why the challenge branch is safe to ship now ─────────────────────────────
 * A progress card frozen at zero would be worse than no card, and challenge
 * evaluation used to run only inside the Strava sync — so a Garmin-only member
 * never moved. Both syncs now call `checkAndAwardChallenges`
 * (api/garmin/sync-activities/route.ts and api/strava/sync-activities/route.ts),
 * and the number on this card is `computeChallengeProgress`, which recomputes from
 * `athlete_activities` on read rather than trusting a stored counter — so it is
 * correct for a Garmin member regardless.
 *
 * Note there is no notion of *joining* a challenge: rows in `challenges` apply to
 * every athlete in scope automatically (individual = themself, group = their pace
 * group). So the card reports on a challenge that is running, and the mockup's
 * one-tap "join" has nothing behind it — an opt-in model would need a join table
 * and a permissions decision about who may create a challenge. Flagged, not built.
 */

/** Columns needed for the run filter plus the two metrics derived here. */
interface ActivityRow extends RunActivityRow {
  start_time: string;
  distance: number;
  duration: number;
}

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  // Staff without an athlete row have no training history to highlight. 200 with
  // a null highlight, not 403: the feed renders fine without this card and a
  // coach opening the feed is not an error.
  if (!auth.user.athleteId) return NextResponse.json({ highlight: null });

  const athleteId = auth.user.athleteId;

  try {
    const supabase = createServerClient();
    const now = new Date();
    const todayKey = israelToday(now);
    const todayAnchor = israelDateAnchor(now);

    const { data: acts, error } = await supabase
      .from('athlete_activities')
      .select('activity_type, start_time, distance, duration')
      .eq('athlete_id', athleteId)
      .order('start_time', { ascending: false });
    if (error) throw error;

    // Same run filter as PRs, badges and challenges, so the number on this card
    // can't disagree with the number on the challenge screen.
    const runs = filterQualifyingRuns((acts || []) as ActivityRow[]);

    // Distinct calendar days with a run, read as the athlete's local day (these
    // timestamps are wall-clock-stored-as-UTC — see lib/utils.ts).
    const activeDayKeys = new Set(runs.map((r) => activityLocalDateStr(r.start_time)));

    // Weekly km, bucketed by activity-week (Monday-based — the Garmin/Strava
    // convention, and the one every other weekly number in the app uses).
    const kmByWeek = new Map<string, number>();
    for (const r of runs) {
      const wk = activityWeekStart(r.start_time);
      kmByWeek.set(wk, (kmByWeek.get(wk) || 0) + r.distance / 1000);
    }

    const thisWeekKey = getActivityWeekStart(todayAnchor);
    const thisWeekKm = kmByWeek.get(thisWeekKey) || 0;

    // The previous N completed weeks, oldest first. Missing weeks stay as 0 on
    // purpose: dropping them would turn "I ran once in three weeks" into "my
    // average is one good week", which flatters a comeback into a decline.
    const priorWeeksKm: number[] = [];
    for (let back = VOLUME_TREND_WEEKS; back >= 1; back--) {
      const key = getActivityWeekStart(new Date(todayAnchor.getTime() - back * 7 * 86400_000));
      priorWeeksKm.push(kmByWeek.get(key) || 0);
    }

    const streak = computeWeekStreak(new Set(kmByWeek.keys()), now);
    const sortedWeekTimes = Array.from(kmByWeek.keys())
      .map((wk) => Date.parse(`${wk}T12:00:00Z`))
      .sort((a, b) => a - b);
    let longestStreak = 0;
    let runLength = 0;
    for (let i = 0; i < sortedWeekTimes.length; i++) {
      if (i > 0 && sortedWeekTimes[i] - sortedWeekTimes[i - 1] === 7 * 86400_000) runLength += 1;
      else runLength = 1;
      if (runLength > longestStreak) longestStreak = runLength;
    }

    const { challenge, challengeSpark } = await resolveChallenge(
      supabase, athleteId, todayKey, runs,
    );

    const highlight: FeedHighlight | null = pickHighlight({
      challenge,
      challengeSpark,
      activeDayKeys,
      todayKey,
      weekStreak: streak,
      longestStreak,
      thisWeekKm,
      priorWeeksKm,
      totalRuns: runs.length,
    });

    return NextResponse.json({ highlight });
  } catch (err: unknown) {
    console.error('Feed highlight error:', err);
    // This card is decoration on the app's landing page — a failure here must not
    // be the reason the feed shows an error state.
    return NextResponse.json({ highlight: null });
  }
}

/**
 * The most urgent active challenge the athlete hasn't finished, with live
 * progress, plus a cumulative-progress sparkline.
 *
 * Soonest end date wins: of two running challenges, the one about to close is the
 * one still worth acting on. Already-completed ones are skipped — the badge and
 * its feed post already said so, and a bar sitting at 100% is not news.
 */
async function resolveChallenge(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  todayKey: string,
  runs: ActivityRow[],
): Promise<{ challenge: HighlightChallenge | null; challengeSpark: number[] }> {
  const { data: rows, error } = await supabase
    .from('challenges')
    .select('id, badge_id, name_he, name_en, metric, target_value, scope, start_date, end_date')
    .eq('active', true)
    .lte('start_date', todayKey)
    .gte('end_date', todayKey)
    .order('end_date', { ascending: true });
  // migration 062 may not be applied in this environment — no challenges, not a 500.
  if (error) return { challenge: null, challengeSpark: [] };

  const catalog = (rows || []) as ChallengeRow[];
  if (catalog.length === 0) return { challenge: null, challengeSpark: [] };

  const badgeIds = catalog.map((c) => c.badge_id);
  const { data: awards } = await supabase
    .from('athlete_badges')
    .select('badge_id')
    .eq('athlete_id', athleteId)
    .in('badge_id', badgeIds);
  const completed = new Set((awards || []).map((a: { badge_id: string }) => a.badge_id));

  const pending = catalog.find((c) => !completed.has(c.badge_id));
  if (!pending) return { challenge: null, challengeSpark: [] };

  const { data: badgeRows } = await supabase
    .from('badges')
    .select('id, icon, icon_url')
    .eq('id', pending.badge_id);
  const badge = ((badgeRows || []) as Array<{ icon: string; icon_url: string | null }>)[0];

  const current = await computeChallengeProgress(supabase, athleteId, pending);
  const daysLeft = Math.max(0, dayKeyDiff(todayKey, pending.end_date));

  // On track = at least as far through the target as through the calendar. One
  // word of copy, and deliberately not a projection: this card does not predict.
  const totalDays = Math.max(1, dayKeyDiff(pending.start_date, pending.end_date) + 1);
  const elapsedDays = Math.min(totalDays, dayKeyDiff(pending.start_date, todayKey) + 1);
  const onTrack =
    pending.target_value <= 0 ||
    current / pending.target_value >= elapsedDays / totalDays;

  return {
    challenge: {
      id: pending.id,
      nameHe: pending.name_he,
      nameEn: pending.name_en,
      icon: badge?.icon || '🏆',
      iconUrl: badge?.icon_url || null,
      metric: pending.metric,
      current: Math.round(current * 10) / 10,
      target: pending.target_value,
      daysLeft,
      onTrack,
    },
    // Cumulative own-progress by day across the window. For a 'group'-scope
    // challenge the headline number is the whole group's pooled total while this
    // line is only the athlete's own contribution — the shape of their own
    // effort, which is the honest thing to draw on their card.
    challengeSpark: cumulativeSpark(runs, pending, todayKey),
  };
}

/** Cumulative metric value per day from the challenge's start to today. */
function cumulativeSpark(runs: ActivityRow[], challenge: ChallengeRow, todayKey: string): number[] {
  const span = Math.max(1, dayKeyDiff(challenge.start_date, todayKey) + 1);
  // One point per day up to a month; beyond that the line is sampled so a
  // 90-day challenge doesn't ship 90 numbers to draw 300 pixels.
  const step = Math.ceil(span / 30);
  const perDay = new Map<string, number>();
  for (const r of runs) {
    const day = activityLocalDateStr(r.start_time);
    if (day < challenge.start_date || day > todayKey) continue;
    const add =
      challenge.metric === 'workout_count' ? 1 :
      challenge.metric === 'distance_km' ? r.distance / 1000 :
      0; // elevation_m isn't selected here; the bar still shows the headline number
    perDay.set(day, (perDay.get(day) || 0) + add);
  }

  const spark: number[] = [];
  let total = 0;
  for (let i = 0; i < span; i++) {
    total += perDay.get(shiftDayKey(challenge.start_date, i)) || 0;
    if (i % step === 0 || i === span - 1) spark.push(Math.round(total * 10) / 10);
  }
  return spark;
}
