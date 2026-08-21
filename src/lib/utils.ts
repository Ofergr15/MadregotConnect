import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  return d.toISOString().split('T')[0];
}

/**
 * The PLAN week start: the Sunday on/before `date`, as YYYY-MM-DD. This matches
 * `weekly_plans.week_start_date` (Sunday–Saturday), so use THIS — not
 * getActivityWeekStart (Monday) — for anything keyed to a scheduled workout
 * (e.g. pre-workout attendance RSVP).
 */
export function getPlanWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // getDay() 0=Sun → subtract to land on Sunday
  return d.toISOString().split('T')[0];
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
  let cursor = now;
  const thisWeekKey = getActivityWeekStart(now);
  if (!weekKeys.has(thisWeekKey)) cursor = new Date(now.getTime() - 7 * 86400_000);
  for (let i = 0; i < 260; i++) { // cap ~5 years
    const key = getActivityWeekStart(cursor);
    if (weekKeys.has(key)) { streak++; cursor = new Date(cursor.getTime() - 7 * 86400_000); }
    else break;
  }
  return streak;
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
export function formatActivityTime(startTime: string): string {
  return new Date(startTime).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
}

export function formatActivityDate(startTime: string): string {
  return new Date(startTime).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** Athlete-local hour (0-23) of an activity, for morning/evening labels etc. */
export function activityLocalHour(startTime: string): number {
  return new Date(startTime).getUTCHours();
}

/** Athlete-local weekday (0=Sun..6=Sat) of an activity. */
export function activityLocalDay(startTime: string): number {
  return new Date(startTime).getUTCDay();
}

/** Athlete-local calendar day (YYYY-MM-DD) of an activity, by its UTC parts. */
export function activityLocalDateStr(startTime: string): string {
  return new Date(startTime).toISOString().split('T')[0];
}

export type GroupLevel = 'fast' | 'medium' | 'slow';

const groupColorMap = {
  fast: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    dot: 'bg-green-400',
    badge: 'bg-green-500/20 text-green-400 border-green-500/30',
    card: 'border-green-500/40 bg-green-500/10 hover:bg-green-500/20',
  },
  medium: {
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    card: 'border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20',
  },
  slow: {
    bg: 'bg-orange-500/20',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    dot: 'bg-orange-400',
    badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    card: 'border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20',
  },
} as const;

const defaultGroupColor = {
  bg: 'bg-slate-500/20',
  text: 'text-slate-400',
  border: 'border-slate-500/30',
  dot: 'bg-slate-400',
  badge: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  card: 'border-slate-500/40 bg-slate-500/10 hover:bg-slate-500/20',
};

export function getGroupColors(level?: GroupLevel | null) {
  if (!level) return defaultGroupColor;
  return groupColorMap[level] || defaultGroupColor;
}

// ── Single source of truth for group identity, name → color/label ────────────
// Group 1 = green (fast), 2 = yellow (medium), 3 = orange (slow). Any place that
// needs a group's display name or color MUST use this — do not re-derive inline
// (that's how two color schemes drifted apart).

export const GROUP_HEX = ['#22c55e', '#eab308', '#f97316'] as const; // 1,2,3
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
    hex: index >= 0 ? GROUP_HEX[index] : '#6366f1',
    colors: index >= 0 ? getGroupColors(level) : defaultGroupColor,
  };
}

/** Convenience: canonical display name only. */
export function groupDisplayName(name?: string | null): string {
  return resolveGroup(name).displayName;
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
