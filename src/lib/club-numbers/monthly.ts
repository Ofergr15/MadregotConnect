/**
 * "מדרגות במספרים" — monthly series for `GET /api/admin/club-numbers?window=…`.
 * Pure arithmetic, no clock and no database (the loader is in ./server).
 *
 * - Only running activity types count (RUN_TYPES), with distance > 0.
 * - Admin and "Test …" accounts are left out, as in computeClubNumbers.
 * - Dates and hours are read off `start_time`'s string (the runner's wall clock stored as UTC).
 * - "Per runner" divides by the runners who ran that month, never by every account.
 * - Pain is counts only: no names, no ids leave this function.
 * - Joined/left/retention use `athletes.removed_at` (migration 209). Without it `removedAt` is
 *   `undefined` for everyone and left/retention are `null`; active members then fall back to
 *   accounts created by the month's end that are not `status = 'removed'` today.
 */
import { israelToday } from '@/lib/utils';
import { RUN_TYPES } from './compute';

export const WINDOWS = ['3m', '12m', 'ytd', 'all'] as const;
export type NumbersWindow = (typeof WINDOWS)[number];
export const parseWindow = (v: string | null): NumbersWindow | null => (WINDOWS as readonly string[]).includes(v ?? '') ? (v as NumbersWindow) : null;

export interface MAthlete { id: string; name: string; role: string | null; status: string | null; createdAt: string; /** undefined = column not there; null = still in. */ removedAt?: string | null }
export interface MRun { athleteId: string; start: string; meters: number; seconds: number; type: string }
export interface MInput {
  today: string; window: NumbersWindow; athletes: MAthlete[]; runs: MRun[];
  kudos: Array<{ athleteId: string; createdAt: string }>;
  comments: Array<{ athleteId: string; createdAt: string }>;
  pain: Array<{ athleteId: string; createdAt: string }>;
}

const monthOf = (iso: string) => iso.slice(0, 7);
/** A real UTC timestamp (created_at/removed_at), bucketed by its Asia/Jerusalem month. */
const stampMonthOf = (iso: string) => israelToday(new Date(iso)).slice(0, 7);
export function addMonths(ym: string, n: number): string {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** The first month of a window. `earliest` (YYYY-MM-DD) anchors `all`. */
export function windowStart(window: NumbersWindow, today: string, earliest?: string): string {
  const now = monthOf(today);
  if (window === '3m') return addMonths(now, -2);
  if (window === '12m') return addMonths(now, -11);
  if (window === 'ytd') return `${today.slice(0, 4)}-01`;
  return earliest && monthOf(earliest) < now ? monthOf(earliest) : now;
}
export function monthsOf(window: NumbersWindow, today: string, earliest?: string): string[] {
  const out: string[] = [];
  for (let m = windowStart(window, today, earliest); m <= monthOf(today); m = addMonths(m, 1)) out.push(m);
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function computeMonthlySeries(x: MInput) {
  const people = x.athletes.filter((a) => !/^test /i.test(a.name) && a.role !== 'admin');
  const ids = new Set(people.map((a) => a.id));
  const hasRemovedAt = people.some((a) => a.removedAt !== undefined);
  const earliest = people.reduce<string | undefined>((m, a) => (!m || a.createdAt < m ? a.createdAt.slice(0, 10) : m), undefined);
  const months = monthsOf(x.window, x.today, earliest);
  const first = months[0], last = months.at(-1)!;
  const inWin = (iso: string) => { const m = monthOf(iso); return m >= first && m <= last; };

  const runs = x.runs.filter((r) => ids.has(r.athleteId) && RUN_TYPES.has(r.type) && r.meters > 0 && inWin(r.start))
    .map((r) => ({ ...r, month: monthOf(r.start), date: r.start.slice(0, 10), hour: Number(r.start.slice(11, 13)), km: r.meters / 1000 }));
  const byMonth = new Map<string, typeof runs>(months.map((m) => [m, []]));
  for (const r of runs) byMonth.get(r.month)!.push(r);

  const memberAt = (a: MAthlete, ym: string) => {
    if (israelToday(new Date(a.createdAt)) > lastDay(ym)) return false;
    if (hasRemovedAt) return !a.removedAt || israelToday(new Date(a.removedAt)) >= `${ym}-01`;
    return a.status !== 'removed';
  };
  const countBy = (rows: Array<{ athleteId: string; createdAt: string }>, ym: string) => rows.filter((r) => ids.has(r.athleteId) && stampMonthOf(r.createdAt) === ym).length;

  const series = months.map((ym) => {
    const rs = byMonth.get(ym)!;
    const per = new Map<string, number>();
    for (const r of rs) per.set(r.athleteId, (per.get(r.athleteId) ?? 0) + 1);
    const ran = per.size;
    const km = rs.reduce((s, r) => s + r.km, 0);
    const startMembers = people.filter((a) => israelToday(new Date(a.createdAt)) < `${ym}-01` && memberAt(a, ym));
    const paces = rs.filter((r) => r.km >= 5 && r.km <= 25 && r.type !== 'treadmill_running' && r.seconds > 0)
      .map((r) => r.seconds / 60 / r.km).filter((v) => v > 3 && v < 8);
    const md = median(paces);
    const kudos = countBy(x.kudos, ym), comments = countBy(x.comments, ym);
    const painRows = x.pain.filter((p) => ids.has(p.athleteId) && stampMonthOf(p.createdAt) === ym);
    return {
      month: ym,
      activeMembers: people.filter((a) => memberAt(a, ym)).length,
      joined: people.filter((a) => stampMonthOf(a.createdAt) === ym).length,
      left: hasRemovedAt ? people.filter((a) => a.removedAt && stampMonthOf(a.removedAt) === ym).length : null,
      retention: hasRemovedAt && startMembers.length
        ? r2(startMembers.filter((a) => !a.removedAt || israelToday(new Date(a.removedAt)) > lastDay(ym)).length / startMembers.length) : null,
      ran1: ran,
      ran8: [...per.values()].filter((n) => n >= 8).length,
      runs: rs.length,
      km: Math.round(km),
      kmPerRunner: ran ? r1(km / ran) : null,
      /** Runs on each weekday, Sunday = 0. */
      weekdays: Array.from({ length: 7 }, (_, d) => rs.filter((r) => dowOf(r.date) === d).length),
      /** Mean distinct weekdays a runner who ran used that month. */
      activeWeekdaysPerRunner: ran ? r1([...per.keys()].reduce((s, id) => s + new Set(rs.filter((r) => r.athleteId === id).map((r) => dowOf(r.date))).size, 0) / ran) : null,
      long20: rs.filter((r) => r.km >= 20).length,
      medianPace: md == null ? null : r2(md),
      kudos, comments,
      kudosPerRunner: ran ? r1(kudos / ran) : null,
      commentsPerRunner: ran ? r1(comments / ran) : null,
      pain: { reports: painRows.length, runners: new Set(painRows.map((p) => p.athleteId)).size },
    };
  });

  /** heat[weekday][hour] — runs across the whole window. */
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const r of runs) if (r.hour >= 0 && r.hour < 24) heat[dowOf(r.date)][r.hour]++;

  return { window: x.window, months, from: `${first}-01`, to: x.today, removedAtTracked: hasRemovedAt, series, heat };
}
