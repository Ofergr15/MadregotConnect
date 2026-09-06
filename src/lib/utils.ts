import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Local-timezone YYYY-MM-DD. Deliberately NOT `d.toISOString().split('T')[0]`
// — that re-expresses the date in UTC first, which silently rolls a date back
// by one day for positive-UTC-offset timezones (e.g. Israel) during the
// window right after local midnight up to the offset (e.g. 00:00–03:00 IDT).
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Start of the ACTIVITY week (Sunday) — matches the club's PLAN week
 * (`getPlanWeekStart`/`weekly_plans.week_start_date`) so every week-boundary
 * concept in the app agrees. Use this for anything that sums real activity
 * distance (leaderboard, runner weekly km, streaks).
 *
 * Changed from Monday to Sunday on 2026-08-21 (explicit product decision, no
 * longer trying to mirror Garmin/Strava's own weekly-mileage boundary).
 * Pre-existing `weekly_km_snapshots` rows computed before this change keep
 * their old Monday-keyed `week_start` values — only the current/previous week
 * gets re-snapshotted on each sync, so historical rows are not rewritten. A
 * one-time backfill would be needed to re-key old rows onto the new boundary.
 *
 * Returns a YYYY-MM-DD string for the Sunday on/before `date`.
 */
export function getActivityWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // getDay() 0=Sun → subtract to land on Sunday
  return toISODate(d);
}

/**
 * The PLAN week start: the Sunday on/before `date`, as YYYY-MM-DD. This matches
 * `weekly_plans.week_start_date` (Sunday–Saturday). Use it for anything keyed to
 * a scheduled workout (e.g. pre-workout attendance RSVP).
 *
 * Identical to `getActivityWeekStart` since the 2026-08-21 Monday→Sunday change,
 * and deliberately still two names: they answer different questions and could
 * diverge again if the club ever re-splits them. This doc used to say "not
 * getActivityWeekStart (Monday)", which stopped being true on that date — the two
 * agree now, so picking the wrong one is a readability problem, not a bug.
 *
 * For "which week is it now?" don't call this with a bare `new Date()` on a
 * server — use `planWeekStartOf`, which anchors on Israel's calendar day.
 */
export function getPlanWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // getDay() 0=Sun → subtract to land on Sunday
  return toISODate(d);
}

/**
 * Consecutive-week run streak: counts back week-by-week (7-day steps, keyed by
 * `getActivityWeekStart`) from the current activity-week — or the previous one
 * if the current week has no qualifying run yet, so the streak doesn't read 0
 * early in a new week before you've run — stopping at the first gap.
 *
 * `weekKeys` is the set of activity-week keys (YYYY-MM-DD Sundays) that have
 * ≥1 qualifying run. Shared by the personal momentum card (one athlete) and
 * the streak leaderboard (many athletes) so streak math is defined ONCE — see
 * /api/athletes/summary and /api/groups/leaderboard.
 */
export function computeWeekStreak(weekKeys: Set<string>, now: Date = new Date()): number {
  let streak = 0;
  // Anchored to Israel's calendar date at local noon, not the raw instant: the
  // week helpers below read local date parts, so on Vercel's UTC clock a bare
  // `new Date()` answers for the UTC date — which is still YESTERDAY between
  // 00:00 and 03:00 Israel, and on a Sunday that's a whole week off.
  let cursor = israelDateAnchor(now);
  const thisWeekKey = getActivityWeekStart(cursor);
  if (!weekKeys.has(thisWeekKey)) cursor = new Date(now.getTime() - 7 * 86400_000);
  for (let i = 0; i < 260; i++) { // cap ~5 years
    const key = getActivityWeekStart(cursor);
    if (weekKeys.has(key)) { streak++; cursor = new Date(cursor.getTime() - 7 * 86400_000); }
    else break;
  }
  return streak;
}

/**
 * Israel's current calendar date (YYYY-MM-DD), DST-aware. This is what "today"
 * means everywhere in this app — the club is entirely in Israel, while every
 * server this runs on has a UTC clock.
 */
export function israelToday(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/**
 * Israel's current calendar date as a Date pinned to local noon. Feed THIS to
 * `getActivityWeekStart`/`getPlanWeekStart`/`toISODate` instead of `new Date()`:
 * those read local date parts, so on a UTC server a raw `new Date()` gives the
 * UTC date, which between 00:00 and 03:00 Israel is still yesterday. Noon leaves
 * ±12h of slack, so the date can't drift again no matter where it's evaluated.
 *
 * Note this deliberately does NOT preserve the time of day — it answers "which
 * day is it in Israel", nothing finer. For the hour/minute use `israelNow`.
 */
export function israelDateAnchor(date: Date = new Date()): Date {
  return new Date(`${israelToday(date)}T12:00:00`);
}

/**
 * The plan week (Sunday, YYYY-MM-DD) that a date falls in — the one helper every
 * "which week is this?" call should use.
 *
 * There were SEVEN hand-rolled versions of this before it existed: five named
 * `sundayOf` (lib/academy/report, api/academy/segments, AcademyPlanComposer,
 * AcademyCompliance, components/academy/types) and two `getCurrentWeekSunday`
 * (dashboard/plan/new, dashboard/activities). The two families disagreed. The
 * `sundayOf` copies anchored on `Date.UTC(...getUTCFullYear(), ...)` and
 * subtracted `getUTCDay()`, i.e. they answered for the UTC calendar date — which
 * between 00:00 and 03:00 in Israel is still YESTERDAY, and when yesterday was a
 * Saturday that is a whole week off. So an athlete opening the app at 00:30 saw
 * the academy screens on last week while the planner and the activities page
 * (local-date based) were on this one. `israelDateAnchor` and `toISODate` above
 * were written to prevent exactly this and the copies simply predate them.
 *
 * Argument forms: omitted/null for "now"; a bare `YYYY-MM-DD`, which is already a
 * calendar date and so is pinned to local noon rather than re-resolved through a
 * timezone; a longer ISO string or a `Date`, both instants, resolved in Israel.
 */
export function planWeekStartOf(date?: string | Date | null): string {
  const anchor =
    date instanceof Date ? israelDateAnchor(date)
    : typeof date === 'string' && date.length >= 10
      ? (date.length === 10 ? new Date(`${date}T12:00:00`) : israelDateAnchor(new Date(date)))
      : israelDateAnchor();
  return getPlanWeekStart(anchor);
}

/** `weeks` whole weeks after (or before) a YYYY-MM-DD week start. */
export function shiftWeekStart(weekStart: string, weeks: number): string {
  return addDaysToDateStr(weekStart, weeks * 7);
}

/**
 * `days` days after (or before) a YYYY-MM-DD date, as YYYY-MM-DD.
 *
 * Local noon in, local date parts out, so a DST switch inside the span moves the
 * clock by an hour and never the date — which `toISOString().split('T')[0]` on a
 * midnight anchor would.
 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * Israel wall-clock parts (Asia/Jerusalem, DST-aware via Intl). weekday 0=Sun..6=Sat.
 * Used by the reminder scheduler so 'Mon 08:00' etc. resolve in Israel local time
 * regardless of the server's UTC clock or the IDT/IST switch.
 */
export function israelNow(date: Date = new Date()): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[parts.weekday as string] ?? 0,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * Activity start_time is Garmin's `startTimeLocal` (the athlete's own wall-clock,
 * e.g. "2026-07-12 06:01:40") stored in a TIMESTAMPTZ column, which Postgres
 * reads as UTC. So the CORRECT local time is the timestamp's UTC wall-clock —
 * reading it in the viewer's zone double-shifts it (e.g. +3h in Israel).
 *
 * These helpers format/inspect an activity time by its UTC parts, giving back
 * the athlete's real local time regardless of where it's viewed.
 */
/**
 * Parses an activity start_time as UTC, whatever shape it arrives in.
 *
 * Postgres hands back `2026-07-12T06:01:40+00:00`, which `new Date()` reads as
 * UTC — but Garmin's own `startTimeLocal` is `2026-07-12 06:01:40`, with a space
 * and no offset, and JS parses THAT as the viewer's local time. In an Israel
 * browser that silently turns a 06:01 run into 03:01, which every helper below
 * then reports as the athlete's "local" time. Since both forms flow through the
 * app (the sync writes the raw Garmin string), normalise before reading parts.
 */
function parseActivityInstant(startTime: string): Date {
  const s = startTime.trim().replace(' ', 'T');
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
}

/**
 * The activity's start time on a 24-hour clock — "6:01", "18:30".
 *
 * Built from the parts rather than through a locale, because there is no locale
 * to ask: this runs in FeedCard, ActivityFeed, GroupRunCard and the plan
 * importer, and it used to hardcode `en-US`, which put an English "AM"/"PM"
 * inside otherwise-Hebrew lines on five screens ("היום ב-8:21 AM"). Israel reads
 * a 24-hour clock, so dropping the meridiem is not a compromise — it is the
 * right format, and it needs no locale plumbing to be correct.
 */
export function formatActivityTime(startTime: string): string {
  const d = parseActivityInstant(startTime);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The activity's date as "Sat, Sep 5" / "שבת, 5 בספט׳".
 *
 * `locale` is threaded in because a date DOES need one — unlike the time above,
 * the weekday and month are words. Defaults to en-US so the server-side and
 * test callers keep their old output; every UI caller passes the viewer's.
 */
export function formatActivityDate(startTime: string, locale: string = 'en-US'): string {
  return parseActivityInstant(startTime).toLocaleDateString(locale, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** Athlete-local hour (0-23) of an activity, for morning/evening labels etc. */
export function activityLocalHour(startTime: string): number {
  return parseActivityInstant(startTime).getUTCHours();
}

/** Athlete-local weekday (0=Sun..6=Sat) of an activity. */
export function activityLocalDay(startTime: string): number {
  return parseActivityInstant(startTime).getUTCDay();
}

/** Athlete-local calendar day (YYYY-MM-DD) of an activity, by its UTC parts. */
export function activityLocalDateStr(startTime: string): string {
  return parseActivityInstant(startTime).toISOString().split('T')[0];
}

/**
 * Activity-week (Sunday) key for an activity's start_time — the Convention-A
 * counterpart to `getActivityWeekStart`, which must only ever be handed a real
 * calendar Date. Using that one here would double-shift: the athlete's local
 * time is already the timestamp's UTC wall-clock, so a 21:30 Saturday run read
 * through local getters in an Israel browser becomes 00:30 Sunday and lands in
 * the WRONG WEEK. All arithmetic here stays in UTC parts, which makes it give
 * the same answer on the server and in any viewer's timezone.
 */
export function activityWeekStart(startTime: string): string {
  const d = parseActivityInstant(startTime);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().split('T')[0];
}

/**
 * Which day word belongs in front of an activity's clock time — the "Today" in
 * Strava's "Today at 8:00 AM" feed header.
 *
 * This is the one place the two conventions meet on purpose: the activity side
 * is Convention A (its own wall-clock, read via UTC parts) while "today" is a
 * real Israeli calendar date. That's also why it can't be a date subtraction on
 * two Dates — one of them isn't a real instant. All arithmetic here is in UTC
 * parts off a noon anchor, so the answer doesn't depend on where it's evaluated.
 */
export function activityDayRelation(
  startTime: string,
  now: Date = new Date(),
): 'today' | 'yesterday' | 'older' {
  return dayKeyRelation(activityLocalDateStr(startTime), now);
}

/**
 * Same question as `activityDayRelation`, asked about a calendar day key
 * (YYYY-MM-DD) that has already been resolved — e.g. by `feedDayKey` below,
 * which has to fold activities and posts onto one axis first.
 */
export function dayKeyRelation(
  dayKey: string,
  now: Date = new Date(),
): 'today' | 'yesterday' | 'older' {
  const today = israelToday(now);
  if (dayKey === today) return 'today';
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return dayKey === yesterday.toISOString().split('T')[0] ? 'yesterday' : 'older';
}

/**
 * Which calendar day a feed item belongs under, as an Israel-local YYYY-MM-DD.
 *
 * The feed is the one screen that stacks both timestamp conventions in a single
 * list, so grouping it needs both readings: an activity's `start_time` is
 * Convention A (the athlete's wall clock stored as if UTC, read via UTC parts),
 * while a post/achievement/announcement's `occurred_at` is a genuine instant and
 * has to be converted to the Israeli calendar date. Reading either one the
 * other's way puts a late-evening item under the wrong heading.
 */
export function feedDayKey(occurredAt: string, activityStartTime?: string | null): string {
  return activityStartTime ? activityLocalDateStr(activityStartTime) : israelToday(new Date(occurredAt));
}

/** Noon anchor for a YYYY-MM-DD key, safe to hand to a UTC-timezone formatter. */
export function dayKeyToDate(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00Z`);
}

export type GroupLevel = 'fast' | 'medium' | 'slow';

// The light system's three group hues: green / sky blue / orange. Group 2 is the
// one that moved — it was yellow, which on the designer's palette has no
// equivalent that survives on a white card (the closest, band 3, is already
// group 3's orange, and two squads must never share a colour). Kept at three
// unmistakably different hues rather than one ramp, because these are identity
// colours (which squad?), not a severity scale.
const groupColorMap = {
  fast: {
    bg: 'bg-accent-600/20',
    text: 'text-accent-900',
    border: 'border-accent-600/30',
    dot: 'bg-accent-600',
    badge: 'bg-accent-600/20 text-accent-900 border-accent-600/30',
    card: 'border-accent-600/40 bg-accent-600/10 hover:bg-accent-600/20',
    chip: { bg: 'bg-accent-600/15', text: 'text-accent-900', border: 'border-accent-600/20' },
    panel: { bg: 'bg-accent-600/10', border: 'border-accent-600/30', text: 'text-accent-900', badge: 'bg-accent-600/20', dot: 'bg-accent-600' },
  },
  medium: {
    bg: 'bg-band-2/20',
    text: 'text-band-2-ink',
    border: 'border-band-2/30',
    dot: 'bg-band-2',
    badge: 'bg-band-2/20 text-band-2-ink border-band-2/30',
    card: 'border-band-2/40 bg-band-2/10 hover:bg-band-2/20',
    chip: { bg: 'bg-band-2/15', text: 'text-band-2-ink', border: 'border-band-2/20' },
    panel: { bg: 'bg-band-2/10', border: 'border-band-2/30', text: 'text-band-2-ink', badge: 'bg-band-2/20', dot: 'bg-band-2' },
  },
  slow: {
    bg: 'bg-band-3/20',
    text: 'text-band-3-ink',
    border: 'border-band-3/30',
    dot: 'bg-band-3',
    badge: 'bg-band-3/20 text-band-3-ink border-band-3/30',
    card: 'border-band-3/40 bg-band-3/10 hover:bg-band-3/20',
    chip: { bg: 'bg-band-3/15', text: 'text-band-3-ink', border: 'border-band-3/20' },
    panel: { bg: 'bg-band-3/10', border: 'border-band-3/30', text: 'text-band-3-ink', badge: 'bg-band-3/20', dot: 'bg-band-3' },
  },
} as const;

const defaultGroupColor = {
  bg: 'bg-ink-300/20',
  text: 'text-ink-500',
  border: 'border-ink-300/40',
  dot: 'bg-ink-300',
  badge: 'bg-ink-300/20 text-ink-500 border-ink-300/40',
  card: 'border-ink-300/50 bg-ink-300/10 hover:bg-ink-300/20',
  // A squad we don't recognise gets neutral ink, not a fourth hue — the three
  // above are the only group colours the app means anything by.
  chip: { bg: 'bg-ink-300/20', text: 'text-ink-500', border: 'border-ink-300/40' },
  panel: { bg: 'bg-ink-300/10', border: 'border-ink-300/30', text: 'text-ink-500', badge: 'bg-ink-300/20', dot: 'bg-ink-300' },
};

export function getGroupColors(level?: GroupLevel | null) {
  if (!level) return defaultGroupColor;
  return groupColorMap[level] || defaultGroupColor;
}

// ── Single source of truth for group identity, name → color/label ────────────
// Group 1 = green (fast), 2 = sky blue (medium), 3 = orange (slow). Any place
// that needs a group's display name or color MUST use this — do not re-derive
// inline (that's how two color schemes drifted apart).

// The hex twins of groupColorMap above (accent-600 / band-2 / band-3), for dots
// and chart series that take an inline color rather than a class. These two lists
// have to move together.
export const GROUP_HEX = ['#16a34a', '#159AFF', '#FF5315'] as const; // 1,2,3
const GROUP_LEVELS: GroupLevel[] = ['fast', 'medium', 'slow'];

export interface ResolvedGroup {
  index: number;        // 0-based (0=Group 1); -1 if unknown
  displayName: string;  // "Group 1" | original name
  level: GroupLevel;
  hex: string;          // brand hex for dots/inline styles
  colors: ReturnType<typeof getGroupColors>; // Tailwind class set
}

/** Map a raw group name (e.g. "Group A - SUB 2:30") to canonical group identity. */
export function resolveGroup(name?: string | null): ResolvedGroup {
  const n = (name || '').toLowerCase();
  let index = -1;
  if (n.includes('group a') || n.includes('group 1') || n.includes('sub 2:30')) index = 0;
  else if (n.includes('group b') || n.includes('group 2') || n.includes('sub 2:35')) index = 1;
  else if (n.includes('group c') || n.includes('group 3') || n.includes('sub 2:45')) index = 2;

  const level = index >= 0 ? GROUP_LEVELS[index] : 'medium';
  return {
    index,
    displayName: index >= 0 ? `Group ${index + 1}` : (name || ''),
    level,
    hex: index >= 0 ? GROUP_HEX[index] : '#159AFF',
    colors: index >= 0 ? getGroupColors(level) : defaultGroupColor,
  };
}

/** Convenience: canonical display name only. */
export function groupDisplayName(name?: string | null): string {
  return resolveGroup(name).displayName;
}

/**
 * A squad's chip colours, resolved from its NAME.
 *
 * Three pages (athletes, academy, groups) each carried their own copy of this
 * table. Two of them keyed it on the literal string `'Group 1'`, so the moment a
 * coach renames a squad to anything real the chip fell through to neutral grey —
 * and the club's squads are in fact named "SUB 2:30" and friends. Going through
 * resolveGroup means every alias the rest of the app understands works here too.
 *
 * Returns null for no name at all, which is the "render no chip" signal those
 * pages already used.
 */
export function getGroupChip(name?: string | null) {
  if (!name) return null;
  return resolveGroup(name).colors.chip;
}

/**
 * A squad's panel colours by 0-based index, for the callers that already know
 * which of the three squads they're drawing and have no name to hand.
 */
export function getGroupPanel(index: number) {
  const level = GROUP_LEVELS[index];
  return (level ? getGroupColors(level) : defaultGroupColor).panel;
}

/**
 * ASCII slug from a free-text name — lowercase, non-alphanumerics collapsed to
 * a single underscore, leading/trailing underscores trimmed. Used to derive a
 * stable machine `code` (e.g. badges.code) from an admin-typed display name
 * instead of asking the admin to type one. Hebrew (or any non-Latin) input
 * slugifies to '' — callers should fall back to a generic prefix + suffix in
 * that case.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (combining diacritical marks)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// A plan is "new" for a couple of days after it's first pushed \u2014 long enough
// to catch someone who doesn't open the app daily, short enough that it
// doesn't linger once everyone's had a chance to see it. Not athlete-specific
// (no per-athlete read state exists), but a reasonable proxy since a coach
// typically pushes a given week's plan once.
const NEW_PLAN_WINDOW_MS = 48 * 60 * 60 * 1000;
export function isRecentlyPublished(publishedAt?: string | null): boolean {
  if (!publishedAt) return false;
  return Date.now() - new Date(publishedAt).getTime() < NEW_PLAN_WINDOW_MS;
}
