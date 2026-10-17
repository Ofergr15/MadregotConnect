import { normalizeStoredLaps, type StoredLap } from '@/lib/garmin/laps';
import { sameClock } from '@/lib/activity-dedup';
import { addDaysToDateStr, activityLocalDateStr } from '@/lib/utils';

// ── Pace at the same heart rate (#105, Yair) ─────────────────────────────────
// Mockup: ~/.cache/madregot/fitness-105/mockup.html. Ofer, 2026-10-17: show heart
// rate and pace per km (not km/h, not a speed÷HR index).
//
// Easy and progressive runs only — an interval session's laps are a different
// effort at the same heart rate. Every lap of 500 m and two minutes or more is put
// in a 5-bpm band by its average HR, and each point on the chart is the pace of all
// that band's laps over the 28 days up to it (total time ÷ total distance), shown
// only when the band has at least 5 km in that window: less is noise, measured on
// prod (a two-week point on 3 km swung 30 s/km).

export type RunKind = 'easy' | 'progressive' | 'interval' | 'skip';

export interface PaceRunInput {
  id: string;
  start_time: string;
  activity_type: string | null;
  distance: number | null;
  duration: number | null;
  laps: unknown;
}

export const BAND_WIDTH = 5;
export const MIN_BPM = 110;
const MIN_LAP_M = 500;
const MIN_LAP_S = 120;
const WINDOW_DAYS = 28;
const MIN_KM_PER_POINT = 5;
const LONG_RUN_M = 18000;
const WALK_PACE = 450; // 7:30/km
const INDOOR = /treadmill|indoor/i;

const lapTime = (l: StoredLap) => l.movingDuration ?? l.duration;
const lapPace = (l: StoredLap) => (lapTime(l) / l.distance) * 1000;

/**
 * Easy, progressive, intervals — or not usable. The plan says so when the run was
 * matched to a workout (`planned`); otherwise the laps' shape does.
 *
 * Intervals are the ones with recoveries: three or more laps at a walk or a stand.
 * Measured on Yair's runs: his Tuesday hills alternate 20-45 s reps with 9-14 min/km
 * walks back down (14 such laps one evening), while his 41.9 km long run has a dozen
 * 20-second pickups and only two water stops. Reps alone don't separate them — on a
 * "hills + 40 min" evening the typical lap is the fast block, so the reps don't look
 * fast. The short laps never count in the bands either way (MIN_LAP_M).
 *
 * Without recoveries: the last third clearly faster than the first,
 * steadily → progressive; an even pace → easy; a long run (18 km+) is easy even when
 * its pace moves; anything else uneven → intervals (a tempo session's blocks).
 */
export function classifyRun(run: PaceRunInput, planned?: RunKind | null): RunKind {
  if (run.activity_type && INDOOR.test(run.activity_type)) return 'skip';
  if (planned === 'interval') return 'interval';
  const laps = normalizeStoredLaps(run.laps).filter(l => l.distance > 0);
  const long = laps.filter(l => l.distance >= MIN_LAP_M);
  if (long.length < 3) return planned && planned !== 'skip' ? planned : 'skip';
  if (planned) return planned;

  const paces = long.map(lapPace);
  const typical = [...paces].sort((a, b) => a - b)[Math.floor(paces.length / 2)];
  // A walk or a stand: 40%+ slower than the run's typical lap AND slower than
  // 7:30/km, so an easy runner's easy lap is never mistaken for a recovery.
  const recoveries = laps.filter(l => lapPace(l) > Math.max(typical * 1.4, WALK_PACE)).length;
  if (recoveries >= 3) return 'interval';

  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const cv = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length) / mean;
  const third = Math.floor(paces.length / 3);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  if (third >= 1 && avg(paces.slice(0, third)) - avg(paces.slice(-third)) > 12 && cv < 0.12) return 'progressive';
  if (cv < 0.08 || (run.distance ?? 0) >= LONG_RUN_M) return 'easy';
  return 'interval';
}

/**
 * One row per physical run: a Garmin run auto-exported to Strava is stored twice,
 * and counting it twice doubles its laps in every band. The copy with more laps wins.
 */
export function oneRowPerRun(runs: PaceRunInput[]): PaceRunInput[] {
  const sorted = [...runs].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const out: PaceRunInput[] = [];
  for (const r of sorted) {
    const t = Date.parse(r.start_time);
    const twin = out.findIndex(o => sameClock(Date.parse(o.start_time), o.duration, t, r.duration));
    if (twin < 0) { out.push(r); continue; }
    if (normalizeStoredLaps(r.laps).length > normalizeStoredLaps(out[twin].laps).length) out[twin] = r;
  }
  return out;
}

export interface BandPoint { date: string; paceSecPerKm: number | null; km: number }
export interface PaceAtHr {
  bands: Record<number, BandPoint[]>;
  /** The band with the most km in the period, and its first and last shown pace. */
  headline: { band: number; from: number; to: number } | null;
  runs: Array<{ id: string; date: string; km: number; kind: RunKind }>;
}

/**
 * The chart: `weeks` points, one a week, ending on `today` (YYYY-MM-DD, Israel's
 * calendar day). Dates come from start_time's own wall clock (activityLocalDateStr).
 */
export function paceAtHr(
  runs: PaceRunInput[],
  opts: { today: string; weeks: number; planned?: Map<string, RunKind> },
): PaceAtHr {
  const firstDay = addDaysToDateStr(opts.today, -(7 * (opts.weeks - 1) + WINDOW_DAYS));
  const unique = oneRowPerRun(runs).filter(r => activityLocalDateStr(r.start_time) > firstDay);
  const laps: Array<{ day: string; band: number; m: number; s: number }> = [];
  const listed: PaceAtHr['runs'] = [];
  for (const r of unique) {
    const kind = classifyRun(r, opts.planned?.get(r.id));
    const day = activityLocalDateStr(r.start_time);
    if (kind !== 'skip') listed.push({ id: r.id, date: day, km: Math.round((r.distance ?? 0) / 100) / 10, kind });
    if (kind !== 'easy' && kind !== 'progressive') continue;
    for (const l of normalizeStoredLaps(r.laps)) {
      const s = lapTime(l);
      if (l.distance < MIN_LAP_M || s < MIN_LAP_S || !l.averageHR || l.averageHR < MIN_BPM) continue;
      laps.push({ day, band: Math.floor(l.averageHR / BAND_WIDTH) * BAND_WIDTH, m: l.distance, s });
    }
  }

  const bands: PaceAtHr['bands'] = {};
  const kmInPeriod: Record<number, number> = {};
  const periodStart = addDaysToDateStr(opts.today, -7 * opts.weeks);
  for (const band of [...new Set(laps.map(l => l.band))].sort((a, b) => a - b)) {
    const mine = laps.filter(l => l.band === band);
    kmInPeriod[band] = mine.filter(l => l.day > periodStart).reduce((a, l) => a + l.m, 0) / 1000;
    bands[band] = Array.from({ length: opts.weeks }, (_, k) => {
      const end = addDaysToDateStr(opts.today, -7 * (opts.weeks - 1 - k));
      const start = addDaysToDateStr(end, -WINDOW_DAYS);
      const inWin = mine.filter(l => l.day > start && l.day <= end);
      const m = inWin.reduce((a, l) => a + l.m, 0);
      const s = inWin.reduce((a, l) => a + l.s, 0);
      return { date: end, km: Math.round(m / 100) / 10, paceSecPerKm: m >= MIN_KM_PER_POINT * 1000 ? Math.round((s / m) * 1000) : null };
    });
  }

  const ranked = Object.keys(kmInPeriod).map(Number).sort((a, b) => kmInPeriod[b] - kmInPeriod[a]);
  let headline: PaceAtHr['headline'] = null;
  for (const band of ranked) {
    const shown = bands[band].filter(p => p.paceSecPerKm != null);
    if (shown.length >= 2) { headline = { band, from: shown[0].paceSecPerKm!, to: shown[shown.length - 1].paceSecPerKm! }; break; }
  }
  return { bands, headline, runs: listed.sort((a, b) => b.date.localeCompare(a.date)) };
}
