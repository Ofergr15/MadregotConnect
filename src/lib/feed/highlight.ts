/**
 * Which single card sits pinned above the feed, and the number on it.
 *
 * The whole point of this card is the ONE sentence under the number. "14" on its
 * own says nothing; "14 days you ran in, out of the last 30" says exactly what
 * the number counts and over what window, without opening another screen. So
 * everything here returns *structured* values — the sentence itself is built from
 * message keys in FeedHighlightCard, because it has to read naturally in Hebrew
 * and English and a server-side string can't.
 *
 * Everything in this file is pure: no I/O, no `new Date()` without an explicit
 * anchor passed in. The route does the fetching; this decides what to say.
 *
 * ── The rotation ──────────────────────────────────────────────────────────────
 * The order is challenge → active days → streak → volume, but each candidate has
 * a QUALIFYING CONDITION and is skipped when it has nothing worth saying. That
 * matters: a plain fallback chain would show "active days" to everyone who has
 * ever run, forever, and the card would become furniture nobody reads — the exact
 * failure mode it exists to avoid. Volume is last because it is the one metric
 * that always has something true to say, so it can carry the card when nothing
 * else earns it.
 */

/** The trailing window "active days" counts over. 30 is what the Statistics
 *  screen's calendar heat map already shows, so the two agree. */
export const ACTIVE_DAYS_WINDOW = 30;

/** How many completed weeks the volume comparison averages over. Three is short
 *  enough to react to a build-up and long enough that one skipped week doesn't
 *  read as a collapse. */
export const VOLUME_TREND_WEEKS = 3;

/** Buckets in the active-days sparkline (30 days / 6 = one bar per 5 days). */
const ACTIVE_DAYS_BUCKETS = 6;

/** How far back to look for a better 30-day window, for the "personal best" line. */
const ACTIVE_DAYS_LOOKBACK = 365;

/** An active-days count at or above this is worth showing on its own merits,
 *  even when it isn't a personal best. Twelve in thirty days is running most
 *  other days — a real habit, and the point at which the number flatters. */
const ACTIVE_DAYS_NOTABLE = 12;

export type HighlightKind = 'challenge' | 'activeDays' | 'streak' | 'volume';

export type ChallengeMetricKind = 'distance_km' | 'workout_count' | 'elevation_m';

export interface HighlightChallenge {
  id: string;
  nameHe: string;
  nameEn: string;
  icon: string;
  iconUrl: string | null;
  metric: ChallengeMetricKind;
  current: number;
  target: number;
  /** Whole days from the anchor date to the challenge's last day, inclusive. */
  daysLeft: number;
  /**
   * Progress is at least as far along as the calendar is. Drives one word of
   * copy, nothing else — it is deliberately not a projection or a warning.
   */
  onTrack: boolean;
}

export interface FeedHighlight {
  kind: HighlightKind;
  /** The big number on the card. Rounded for display by the component. */
  value: number;
  /**
   * The mini chart, oldest → newest. Bare numbers on an arbitrary scale: the
   * component normalises against the max, so the units never have to leave here.
   */
  spark: number[];
  challenge?: HighlightChallenge;
  activeDays?: { days: number; window: number; isBest: boolean };
  streak?: { weeks: number; longest: number };
  /** `deltaPct` is signed, relative to `averageKm`; 0 when there's no average. */
  volume?: { km: number; averageKm: number; deltaPct: number };
}

// ─── day-key arithmetic ────────────────────────────────────────────────────────
// Everything below works on bare `YYYY-MM-DD` strings rather than Date objects.
// Activity timestamps in this app are wall-clock-stored-as-UTC (Convention A in
// lib/utils.ts), so their calendar day is already correct as text — converting to
// a Date in the viewer's zone and back is how the off-by-one bugs get in.

/** `YYYY-MM-DD` shifted by whole days. Negative `delta` goes backwards. */
export function shiftDayKey(dayKey: string, delta: number): string {
  const t = Date.parse(`${dayKey}T00:00:00Z`);
  return new Date(t + delta * 86400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function dayKeyDiff(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000,
  );
}

// ─── active days ───────────────────────────────────────────────────────────────

/**
 * How many distinct days in the trailing window had at least one run, plus a
 * sparkline of that window in equal buckets (oldest bucket first).
 *
 * The window includes `todayKey` itself and reaches back `window - 1` days, so a
 * 30-day window is thirty calendar days ending today — not thirty-one.
 */
export function activeDaysInWindow(
  activeDayKeys: Set<string>,
  todayKey: string,
  window = ACTIVE_DAYS_WINDOW,
  buckets = ACTIVE_DAYS_BUCKETS,
): { days: number; spark: number[] } {
  const spark = new Array<number>(buckets).fill(0);
  let days = 0;
  for (let back = 0; back < window; back++) {
    if (!activeDayKeys.has(shiftDayKey(todayKey, -back))) continue;
    days += 1;
    // `back` 0 is today, which belongs in the LAST bucket — the chart reads
    // left-to-right as oldest-to-newest like every other chart in the app.
    const fromOldest = window - 1 - back;
    const bucket = Math.min(buckets - 1, Math.floor((fromOldest * buckets) / window));
    spark[bucket] += 1;
  }
  return { days, spark };
}

/**
 * The best active-days count over any earlier window of the same length — what
 * "a personal best for the month" is measured against.
 *
 * Windows are stepped one day at a time and every window that includes today is
 * excluded, so the current count is compared against genuinely past form rather
 * than against 29 windows that mostly overlap it. Returns 0 when there's no
 * history to compare with, which makes any nonzero current count a "best" — and
 * that's correct for someone's first month.
 */
export function bestPriorActiveDays(
  activeDayKeys: Set<string>,
  todayKey: string,
  window = ACTIVE_DAYS_WINDOW,
  lookback = ACTIVE_DAYS_LOOKBACK,
): number {
  let best = 0;
  // A window ending `end` days before today contains no part of the current
  // window once `end >= window`.
  for (let end = window; end <= lookback; end++) {
    const endKey = shiftDayKey(todayKey, -end);
    let count = 0;
    for (let back = 0; back < window; back++) {
      if (activeDayKeys.has(shiftDayKey(endKey, -back))) count += 1;
    }
    if (count > best) best = count;
  }
  return best;
}

// ─── selection ─────────────────────────────────────────────────────────────────

export interface HighlightInput {
  /**
   * The most urgent active challenge the athlete has NOT yet completed — the
   * route picks it (soonest end date first). Null when there is none.
   *
   * Note there is no opt-in: `challenges` applies to every athlete in scope
   * automatically, so this is "a challenge is running" and not "a challenge they
   * joined". See the note in the route.
   */
  challenge: HighlightChallenge | null;
  /** Sparkline for the challenge: cumulative progress by day, oldest first. */
  challengeSpark?: number[];
  /** Distinct `YYYY-MM-DD` days with at least one qualifying run, all time. */
  activeDayKeys: Set<string>;
  /** Today, as the athlete's calendar day. */
  todayKey: string;
  /** Consecutive activity-weeks with a run, from GET /api/athletes/summary's math. */
  weekStreak: number;
  longestStreak: number;
  /** This activity-week's km. */
  thisWeekKm: number;
  /**
   * The previous VOLUME_TREND_WEEKS completed weeks' km, oldest first. Weeks with
   * no runs are present as 0 — dropping them would flatter a comeback.
   */
  priorWeeksKm: number[];
  /** Total qualifying runs ever. Zero hides the card entirely. */
  totalRuns: number;
}

/**
 * The one card to show, or null to show nothing at all.
 *
 * Null is a real outcome, not a failure: a member who has never synced a run has
 * nothing true to say in this slot, and an empty progress card stuck on zero is
 * worse than no card. (That was also the argument for fixing challenge evaluation
 * on Garmin sync before shipping this — see the route.)
 */
export function pickHighlight(input: HighlightInput): FeedHighlight | null {
  if (input.totalRuns === 0) return null;

  // 1 · An active challenge always wins. It has a target and a deadline, which is
  //     the only thing on this list the athlete can still act on today.
  if (input.challenge && input.challenge.current < input.challenge.target) {
    return {
      kind: 'challenge',
      value: input.challenge.current,
      spark: input.challengeSpark ?? [],
      challenge: input.challenge,
    };
  }

  // 2 · Active days, but only when the number flatters: a personal best for the
  //     window, or a genuine habit. Six days in thirty is not a headline.
  const { days, spark } = activeDaysInWindow(input.activeDayKeys, input.todayKey);
  const best = bestPriorActiveDays(input.activeDayKeys, input.todayKey);
  const isBest = days > best;
  if (days > 0 && (isBest || days >= ACTIVE_DAYS_NOTABLE)) {
    return {
      kind: 'activeDays',
      value: days,
      spark,
      activeDays: { days, window: ACTIVE_DAYS_WINDOW, isBest },
    };
  }

  // 3 · A streak is only a streak from two weeks up. "1 week streak" is just
  //     "you ran this week", which the volume card says better.
  if (input.weekStreak >= 2) {
    return {
      kind: 'streak',
      value: input.weekStreak,
      // One bar per week of the streak, rising — a shape, not data. Capped so a
      // 40-week streak doesn't draw 40 hairlines.
      spark: Array.from({ length: Math.min(input.weekStreak, 12) }, (_, i) => i + 1),
      streak: { weeks: input.weekStreak, longest: input.longestStreak },
    };
  }

  // 4 · Volume vs their own trailing average. The fallback that always has
  //     something to say — including "you're below your average", which is
  //     information and not a scolding, so it ships as a neutral delta.
  const averageKm = input.priorWeeksKm.length
    ? input.priorWeeksKm.reduce((a, b) => a + b, 0) / input.priorWeeksKm.length
    : 0;
  if (input.thisWeekKm <= 0 && averageKm <= 0) return null;
  const deltaPct = averageKm > 0
    ? Math.round(((input.thisWeekKm - averageKm) / averageKm) * 100)
    : 0;
  return {
    kind: 'volume',
    value: Math.round(input.thisWeekKm * 10) / 10,
    spark: [...input.priorWeeksKm, input.thisWeekKm],
    volume: {
      km: Math.round(input.thisWeekKm * 10) / 10,
      averageKm: Math.round(averageKm * 10) / 10,
      deltaPct,
    },
  };
}
