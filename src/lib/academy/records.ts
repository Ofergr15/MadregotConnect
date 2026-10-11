import { bestSegmentSeconds, lapMeters, lapSeconds, type LapLike } from '@/lib/prs/best-segment';
import { computeDistanceBests, filterQualifyingRuns, PR_BUCKETS } from '@/lib/prs/pr-buckets';

/**
 * One record rule for every surface that shows a 🏅 — screen 5's medal, the week row's mark
 * and the coach's readiness line (C1) — so the trainee and the coach never disagree about a
 * record (mockup 5: "🏅 שיא חדש ל־1 ק״מ, החזרה החמישית 3:56 במקום 3:59").
 *
 * The buckets, shortest first: the fastest kilometre inside a run (a rep), then the
 * profile's PR buckets (lib/prs/pr-buckets, 5K and up). The shortest wins the one line — a
 * 5K "inside" a reps session is reps and jogs, while the fastest rep is the record a coach
 * means.
 */

export const RECORD_BUCKETS: ReadonlyArray<{ key: string; meters: number }> = [
  { key: '1k', meters: 1000 },
  ...PR_BUCKETS.map(b => ({ key: b.key, meters: b.meters })),
];

/** The shortest run that can hold any record (the 1 km bucket, less a GPS percent). */
export const RECORD_MIN_M = 990;

export interface RecordRunLike {
  id?: string;
  start_time: string;
  activity_type?: string | null;
  distance: number;
  duration: number;
  laps?: LapLike[] | null;
  activity_name?: string | null;
}

/** A run's best time in a bucket, seconds, or null. */
export function bestIn(run: RecordRunLike, bucket: { key: string; meters: number }): number | null {
  if (bucket.key === '1k') return bestSegmentSeconds(run.laps, 1000);
  const found = computeDistanceBests(filterQualifyingRuns([run])).find(b => b.key === bucket.key);
  return found?.seconds ?? null;
}

/** A lap this close to 1 km is a rep of it (the watch's auto-lap or a 1000 m step). */
const REP_TOLERANCE = 0.05;

/**
 * Which rep of 1 km the best kilometre was (1-based), when the run's kilometre laps hold
 * it: "החזרה החמישית". Null when the fastest kilometre spans laps (a steady run).
 */
export function repOfBest(laps: LapLike[] | null | undefined, bestSec: number): number | null {
  if (!Array.isArray(laps)) return null;
  let n = 0;
  for (const lap of laps) {
    const m = lapMeters(lap);
    const s = lapSeconds(lap);
    if (!(m > 0 && s > 0) || Math.abs(m - 1000) > 1000 * REP_TOLERANCE) continue;
    n += 1;
    if (Math.abs(s * (1000 / m) - bestSec) < 1) return n;
  }
  return null;
}

export interface RunRecord {
  bucket: string;
  meters: number;
  value: number;
  previous: number;
  previousDate: string;
  /** The rep that set a 1 km record, 1-based; absent otherwise. */
  rep?: number;
}

/**
 * A personal record set on `run`: for some bucket (shortest first) this run's best beats
 * every EARLIER run in `others` — one must exist (a first 10K is a first, not a record) —
 * and no LATER run in the window has beaten it since.
 */
export function recordOn<T extends RecordRunLike & { id: string }>(run: T, others: T[]): RunRecord | null {
  if (!filterQualifyingRuns([run]).length) return null;
  const pool = filterQualifyingRuns(others.filter(o => o.id !== run.id));
  for (const bucket of RECORD_BUCKETS) {
    const mine = bestIn(run, bucket);
    if (mine == null) continue;
    let prev: { sec: number; date: string } | null = null;
    let beatenLater = false;
    for (const o of pool) {
      const s = bestIn(o, bucket);
      if (s == null) continue;
      if (o.start_time < run.start_time) {
        if (!prev || s < prev.sec) prev = { sec: s, date: o.start_time };
      } else if (s <= mine) {
        beatenLater = true;
      }
    }
    if (!prev || beatenLater || !(mine < prev.sec)) continue;
    const out: RunRecord = {
      bucket: bucket.key, meters: bucket.meters, value: Math.round(mine), previous: Math.round(prev.sec), previousDate: prev.date.slice(0, 10),
    };
    if (bucket.key === '1k') {
      const rep = repOfBest(run.laps, mine);
      if (rep != null) out.rep = rep;
    }
    return out;
  }
  return null;
}
