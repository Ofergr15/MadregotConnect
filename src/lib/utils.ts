import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Start of the ACTIVITY week (Monday), matching how Garmin and Strava report
 * weekly mileage. Use this for anything that sums real activity distance
 * (leaderboard, runner weekly km) so our numbers line up with the watch.
 *
 * NOTE: This is intentionally different from the coach's PLAN week, which runs
 * Sunday–Saturday and is keyed by `weekly_plans.week_start_date`. Do NOT use
 * this helper to look up plans.
 *
 * Returns a YYYY-MM-DD string for the Monday on/before `date`.
 */
export function getActivityWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
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
