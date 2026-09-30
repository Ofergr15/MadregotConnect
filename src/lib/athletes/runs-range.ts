import { buildRecentRuns, type RecentRun } from '@/lib/athletes/profile-stats';
import type { RunActivityRow } from '@/lib/prs/pr-buckets';
import { toRoute } from '@/lib/feed/project';
import { activityLocalDateStr, toISODate } from '@/lib/utils';

/**
 * THE RUNS OF ONE WINDOW, FOR THE PROFILE'S TWO RUN VIEWS (like Strava's profile).
 *
 * "Weeks": tap a bar of the ten-week chart and that week's runs list under it.
 * "Calendar": a month, a circle per day sized by its kilometres. Both ask for one
 * window at a time rather than the athlete's whole history, and each run carries
 * the ~60-point route preview so the row can draw its map without a second read.
 */

export interface RangeRun extends RecentRun {
  routePreview: Array<{ lat: number; lng: number }> | null;
}

/** A month is the widest window either view asks for; this leaves room for a 6-week grid. */
export const MAX_RANGE_DAYS = 42;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `from` inclusive, `to` exclusive, both YYYY-MM-DD; null for anything else or too wide. */
export function parseRunsRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  if ((b - a) / 86400_000 > MAX_RANGE_DAYS) return null;
  return { from, to };
}

export function buildRangeRuns<T extends RunActivityRow & { route_preview?: unknown }>(rows: T[]): RangeRun[] {
  const preview = new Map(rows.map((r) => [r.id ?? r.start_time, toRoute(r.route_preview)]));
  return buildRecentRuns(rows, rows.length).map((r) => ({ ...r, routePreview: preview.get(r.id ?? r.startTime) ?? null }));
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** The month holding `day`, as a window: its 1st, and the 1st of the next. */
export function monthRange(day: string): { from: string; to: string } {
  const [y, m] = day.split('-').map(Number);
  return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 1)) };
}

/**
 * The month as calendar cells, Sunday first like the club's week: blanks until the
 * 1st falls on its weekday, then every day with the kilometres run on it.
 */
export function calendarCells(monthStart: string, runs: RangeRun[]): Array<{ day: string; km: number; runs: RangeRun[] } | null> {
  const byDay = new Map<string, RangeRun[]>();
  for (const r of runs) {
    const d = activityLocalDateStr(r.startTime);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const first = new Date(`${monthStart}T12:00:00`);
  const cells: Array<{ day: string; km: number; runs: RangeRun[] } | null> = Array(first.getDay()).fill(null);
  const { to } = monthRange(monthStart);
  for (let day = monthStart; day < to; day = addDays(day, 1)) {
    const list = (byDay.get(day) ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
    cells.push({ day, km: Math.round(list.reduce((s, r) => s + r.km, 0) * 10) / 10, runs: list });
  }
  return cells;
}
