// The quality session for Instagram — the pure half. On a morning whose plan is
// intervals / tempo / fartlek, one club member (the super user while it is tried
// out) picks ONE runner per pack and shares that runner's run, titled as the
// pack: "this is what pack 1 ran". The screen is /dashboard/quality-session, the
// data GET /api/quality-session, the 7:30 push a stage of /api/cron/tick.
//
// Design: ~/.cache/madregot/mockups/quality-session-v2.html (the prototype before it: quality-session-prototype.html).
// Units, as everywhere: distance METERS, duration SECONDS, pace SECONDS PER KM.

import type { StoredLap } from '@/lib/garmin/laps';
import type { WorkoutType } from '@/lib/plans/session-summary';
import type { Pack } from '@/lib/pack-stories/model';
import type { PlanTargets } from './parts';

export const QUALITY_TYPES: WorkoutType[] = ['intervals', 'tempo', 'fartlek'];

/** Minutes after local midnight. The push goes at 7:30; the feed row shows 07:00–11:00. */
export const PUSH_AT = 7 * 60 + 30;
export const ROW_FROM = 7 * 60;
export const ROW_UNTIL = 11 * 60;

export interface QualityWorkout { name: string; type: WorkoutType }

export type LapKind = 'rep' | 'easy' | 'rest';
/** [meters, seconds, kind] per watch lap. */
export type QsLap = [number, number, LapKind];

const WATCH_KIND: Record<string, LapKind> = {
  WARMUP: 'easy', COOLDOWN: 'easy', ACTIVE: 'rep', INTERVAL: 'rep', REST: 'rest', RECOVERY: 'rest',
};
/** A rep is at least this long and this much faster than the run's median lap. */
const REP_MIN_METERS = 150;
const REP_FASTER_BY = 12;
/** Slower than easy by this much, and short: a standing or walking recovery. */
const REST_SLOWER_BY = 60;

const paceOf = (l: StoredLap) => (l.distance > 0 ? (l.duration / l.distance) * 1000 : Infinity);

/**
 * Which laps were the work. The watch's own marker when the athlete ran a
 * structured workout from it (only then is intensityType meaningful, see
 * StoredLap); otherwise a lap well faster than the run's median lap.
 */
export function detectReps(laps: StoredLap[]): QsLap[] {
  const ls = laps.filter(l => l.distance > 0 && l.duration > 0);
  const structured = ls.some(l => l.wktStepIndex != null && l.intensityType && WATCH_KIND[l.intensityType] === 'rep');
  if (structured) {
    return ls.map(l => [Math.round(l.distance), Math.round(l.duration),
      (l.wktStepIndex != null && WATCH_KIND[l.intensityType || '']) || 'easy']);
  }
  const paces = ls.map(paceOf).sort((a, b) => a - b);
  const median = paces.length ? paces[Math.floor(paces.length / 2)] : 0;
  return ls.map(l => {
    const p = paceOf(l);
    let kind: LapKind = 'easy';
    if (l.distance >= REP_MIN_METERS && p <= median - REP_FASTER_BY) kind = 'rep';
    else if (l.distance < 600 && p >= median + REST_SLOWER_BY) kind = 'rest';
    return [Math.round(l.distance), Math.round(l.duration), kind];
  });
}

/** Pace over the reps alone — "fastest" on a quality day — or null with no reps. */
export function repPace(laps: QsLap[]): number | null {
  let m = 0, s = 0;
  for (const [lm, ls, k] of laps) if (k === 'rep') { m += lm; s += ls; }
  return m > 0 ? Math.round((s / m) * 1000) : null;
}

/** One run of the morning, as the API ships it. */
export interface QsRun {
  id: string;
  athleteId: string;
  name: string;
  pack: 0 | Pack;
  dup: boolean;
  /** Local HH:MM, start and finish. */
  start: string;
  end: string;
  dist: number;
  dur: number;
  pace: number;
  repPace: number | null;
  laps: QsLap[];
}

export interface QsSession {
  date: string;
  label: string;
  workout: QualityWorkout | null;
  /** Each pack's work steps for the morning, for the targets on the screen. */
  plan: PlanTargets;
  runs: QsRun[];
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (n: number) => {
  const c = Math.min(Math.max(0, Math.round(n)), 24 * 60 - 1);
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
};

/** Runs that start later than this are not the morning session. */
export const MORNING_ENDS = toMinutes('12:00');

/**
 * The runs of one pack as seen at `nowMin`: a run not yet finished then isn't
 * there yet (that is how "as if it were 08:00" stays honest), duplicates never.
 */
export function packRuns(sess: QsSession, pack: 0 | Pack, nowMin: number): QsRun[] {
  return sess.runs.filter(r => !r.dup && r.pack === pack && toMinutes(r.start) < MORNING_ENDS && toMinutes(r.end) <= nowMin);
}

/** One runner of the morning: their longest run, the only one the screen shows. */
export interface QsRunner { run: QsRun }

/**
 * The runs, one row per runner: the longest run of the morning that has laps. A
 * jog to the start, the shorter half of a split run, or a lap-less copy from a
 * second app is dropped, not listed or counted.
 */
export function runnersOf(rs: QsRun[]): QsRunner[] {
  const by = new Map<string, QsRun[]>();
  for (const r of rs) by.set(r.athleteId, [...(by.get(r.athleteId) || []), r]);
  return [...by.values()].map(g => {
    const run = g.reduce((a, b) => ((b.laps.length > 1 ? 1 : 0) - (a.laps.length > 1 ? 1 : 0) || b.dist - a.dist) > 0 ? b : a);
    return { run };
  });
}

/** "חדש": finished after the 7:30 push went out. */
export const isNew = (r: QsRun) => toMinutes(r.end) > PUSH_AT;

export type SortKey = 'km' | 'reps';
export function sortRuns(rs: QsRun[], by: SortKey): QsRun[] {
  const fast = (r: QsRun) => r.repPace ?? r.pace ?? Infinity;
  return rs.slice().sort(by === 'km' ? (a, b) => b.dist - a.dist : (a, b) => fast(a) - fast(b));
}

/** The share card's title: the pack, then the session. */
export function shareTitle(pack: 0 | Pack, workout: QualityWorkout | null): string {
  const p = pack ? `דבוקה ${pack}` : 'אימון האיכות';
  const w = (workout?.name || '').trim();
  return w ? `${p} · ${w}` : p;
}

// ── the clock, with time travel ──────────────────────────────────────────────
// `?at=2026-09-29T08:00` on the feed or the screen makes it that moment for the
// super user (kept for the tab, `?at=off` clears it), so a quality morning can be
// looked at on any day. Only the window and the "finished by now" cut read it.

export interface QsClock { date: string; minutes: number; travelling: boolean }

const AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
export function parseAt(s: string | null | undefined): { date: string; minutes: number } | null {
  const m = AT.exec((s || '').trim());
  if (!m) return null;
  const h = Number(m[2]), mi = Number(m[3]);
  if (h > 23 || mi > 59) return null;
  return { date: m[1], minutes: h * 60 + mi };
}

export const inRowWindow = (minutes: number) => minutes >= ROW_FROM && minutes < ROW_UNTIL;
