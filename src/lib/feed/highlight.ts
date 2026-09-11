/**
 * What the card pinned above the feed says.
 *
 * Two things, both about the reader, both actionable today:
 *  1. **This week's kilometres against the week's target** — the coach's planned
 *     volume for the week, so the number has something to be measured against.
 *  2. **The active challenge and whether they've finished it.**
 *
 * That is the whole list. An earlier version rotated through four metrics (active
 * days, week streak, volume vs your own average); it was cut on purpose. A card
 * that shows a different metric every time you open the app teaches people not to
 * read it, and none of those four could be acted on the way "you're 12 km short
 * with two days left" can.
 *
 * Everything here is pure: no I/O, no `new Date()` without an anchor passed in.
 * The route gathers; this decides what there is to say. The sentences themselves
 * are built in FeedHighlightCard from message keys, because they have to read
 * naturally in Hebrew and English and a server-built string can't.
 */

/** The one week the card talks about — the activity week, Monday–Sunday. */
export const WEEK_DAYS = 7;

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
  /** Whole days from today to the challenge's last day, inclusive. */
  daysLeft: number;
  /**
   * The badge is already awarded — they finished this one.
   *
   * Completed challenges used to be filtered out of this card entirely. They are
   * shown now because "did I do it?" was the actual question being asked of it, and
   * a challenge that vanishes the moment you complete it never gets to say so.
   */
  done: boolean;
  /**
   * Progress is at least as far along as the calendar is. Drives one word of copy
   * and nothing else — deliberately not a projection or a warning.
   */
  onTrack: boolean;
}

export interface HighlightWeek {
  /**
   * The Monday this activity week starts on, `YYYY-MM-DD`. Not the plan week the
   * target came from — see the "Which week" note in api/feed/highlight.
   *
   * Shipped to the client for one reason: it is what the dismiss X keys its
   * "hidden" flag on, so hiding the card hides *this* week's card and next
   * Monday's comes back on its own. A dismissal with no way back is a trap.
   */
  weekStart: string;
  /** Kilometres run so far in this activity week. */
  km: number;
  /**
   * The coach's planned range for this week. Both 0 when no plan covers it — a
   * new member's first week, or a week the coach hasn't published.
   *
   * It's a range because that's how the plans are written ("12–14 ק״מ"). The low
   * end is what the card measures against: it's the commitment, and the high end
   * is headroom.
   */
  targetMin: number;
  targetMax: number;
  /**
   * Per-day kilometres for this week. Always seven values, zeros included.
   *
   * Index 0 is `weekStart` — i.e. Monday, because this is the activity week — and
   * NOT Sunday. It used to be Sunday and the note here used to say so; anything
   * that puts a name on these seven bars must take the order from `weekStart`
   * (see `weekDayKeys`) rather than assume it, because assuming it shipped a bug.
   */
  dailyKm: number[];
  /**
   * Days of the week gone by, today included: 1 on `weekStart` itself, 7 on the
   * last day of the week. So `dailyKm[daysElapsed - 1]` is today's bar, whichever
   * weekday the week is anchored on.
   */
  daysElapsed: number;
}

export interface FeedHighlight {
  week: HighlightWeek;
  /** The most urgent active challenge, finished or not. Null when none is running. */
  challenge: HighlightChallenge | null;
}

// ─── day-key arithmetic ────────────────────────────────────────────────────────
// Bare `YYYY-MM-DD` strings rather than Date objects. Activity timestamps in this
// app are wall-clock-stored-as-UTC (Convention A in lib/utils.ts), so their
// calendar day is already correct as text — converting to a Date in the viewer's
// zone and back is how the off-by-one bugs get in.

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

// ─── the day strip ─────────────────────────────────────────────────────────────

/**
 * Weekday name suffixes for the `feedHighlight.day_*` message keys, indexed the
 * way `Date.getUTCDay()` is: Sunday 0 … Saturday 6.
 *
 * This is a lookup from a weekday NUMBER to a key. It is deliberately not
 * exported and deliberately not the order the strip is drawn in — that is
 * `weekDayKeys`, below, and the difference between the two is the whole bug this
 * pair of functions exists to prevent.
 */
const DAY_KEY_BY_WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type HighlightDayKey = (typeof DAY_KEY_BY_WEEKDAY)[number];

/**
 * The seven weekday labels for a week's day strip, in the SAME order as that
 * week's `dailyKm` — derived from `weekStart` instead of assumed.
 *
 * Assuming it was a live bug. `dailyKm` used to start on Sunday and the strip
 * hard-coded Sunday-first labels to match. On 2026-09-09 the route moved to the
 * ACTIVITY week so the headline total would agree with the athlete's watch
 * (Monday–Sunday), and the labels stayed behind. From that day until this fix
 * every bar was drawn under the PREVIOUS day's name: on Thursday 2026-09-10 a
 * 16 km morning run sat under ד׳ (Wednesday) while ה׳ (Thursday) was an empty
 * track — so today's run read as "didn't sync", and was reported that way by an
 * athlete who could see the very same run in the club feed directly below the
 * card. The kilometres were never wrong; only the names over them were.
 *
 * Deriving the names from `weekStart` means the strip follows the array. If the
 * anchor moves a third time the labels move with it, with nothing left to keep in
 * step by hand.
 *
 * `weekStart` is a bare `YYYY-MM-DD` and is read through UTC parts only, for the
 * same reason the day-key arithmetic above is: resolving it in the viewer's zone
 * would slide the whole strip by a day for anyone west of Greenwich.
 */
export function weekDayKeys(weekStart: string): HighlightDayKey[] {
  const parsed = new Date(`${weekStart}T00:00:00Z`).getUTCDay();
  // A malformed key gives NaN, and `DAY_KEY_BY_WEEKDAY[NaN]` is `undefined` —
  // which reaches the translator as `day_undefined` and throws inside the render,
  // taking the whole feed page down with it. Falling back to Sunday-first is
  // wrong-but-legible; a blank feed is neither.
  const first = Number.isNaN(parsed) ? 0 : parsed;
  return Array.from({ length: WEEK_DAYS }, (_, i) => DAY_KEY_BY_WEEKDAY[(first + i) % 7]);
}

// ─── the week's verdict ────────────────────────────────────────────────────────

export type WeekStatus = 'noTarget' | 'met' | 'onTrack' | 'behind';

/**
 * One word for how the week is going, and it is only ever one of four.
 *
 * `behind` is pro-rated against the days gone by, not against the whole week —
 * otherwise every athlete is "behind" until Friday, which is both useless and
 * discouraging. On Wednesday of a 40 km week, 17 km is on track.
 *
 * `met` wins over everything once the low end of the range is reached: the range
 * is the coach's, and its floor is the number that was asked for.
 */
export function weekStatus(week: HighlightWeek): WeekStatus {
  const bar = week.targetMin > 0 ? week.targetMin : week.targetMax;
  if (bar <= 0) return 'noTarget';
  if (week.km >= bar) return 'met';
  const elapsed = Math.min(WEEK_DAYS, Math.max(1, week.daysElapsed));
  return week.km / bar >= elapsed / WEEK_DAYS ? 'onTrack' : 'behind';
}

/**
 * Kilometres still to run to clear the bar `weekStatus` measures against, so the
 * card and the verdict can never disagree about what "behind" means. Never
 * negative: once the week is met there is nothing left to owe.
 */
export function weekRemainingKm(week: HighlightWeek): number {
  const bar = week.targetMin > 0 ? week.targetMin : week.targetMax;
  return Math.max(0, Math.round((bar - week.km) * 10) / 10);
}

// ─── assembly ──────────────────────────────────────────────────────────────────

export interface HighlightInput {
  /** First day of the activity week being reported on — the Monday, `YYYY-MM-DD`. */
  weekStart: string;
  weekKm: number;
  weekTargetMin: number;
  weekTargetMax: number;
  /** Per-day kilometres starting on `weekStart`, not on Sunday. Padded to seven here. */
  weekDailyKm: number[];
  daysElapsed: number;
  challenge: HighlightChallenge | null;
}

/**
 * The card's contents, or null to render nothing at all.
 *
 * Null is a real outcome and not a failure: with no runs this week, no target to
 * work toward and no challenge running there is nothing true to put in this slot,
 * and a progress card stuck on zero is worse than no card. That was also the
 * argument for fixing challenge evaluation on the Garmin sync before shipping
 * this — see the route.
 */
export function buildHighlight(input: HighlightInput): FeedHighlight | null {
  const dailyKm = Array.from({ length: WEEK_DAYS }, (_, i) =>
    Math.round((input.weekDailyKm[i] || 0) * 10) / 10,
  );
  const week: HighlightWeek = {
    weekStart: input.weekStart,
    km: Math.round(input.weekKm * 10) / 10,
    targetMin: Math.round(input.weekTargetMin * 10) / 10,
    targetMax: Math.round(input.weekTargetMax * 10) / 10,
    dailyKm,
    daysElapsed: Math.min(WEEK_DAYS, Math.max(1, input.daysElapsed)),
  };

  if (week.km <= 0 && week.targetMax <= 0 && !input.challenge) return null;

  return { week, challenge: input.challenge };
}
