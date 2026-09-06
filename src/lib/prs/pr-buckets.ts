/**
 * PR-bucket definitions + detection — the SINGLE source of truth for "which
 * distance bucket does this run qualify for". Shared by GET /api/athletes/prs
 * (display: fastest qualifying run per bucket) and the badge award engine's
 * `pr_bucket` rule_type (059_badges.sql: first_5k/first_10k/first_hm/first_fm
 * — award the moment a bucket is EVER hit). Changing the tolerance window or
 * run-type filter here changes both consistently — do not duplicate this math
 * elsewhere (see award-engine.ts).
 *
 * Distance bests use a tolerance window so real-world runs (never exactly
 * 5.00km) still count as a "5K effort".
 */
import { bestSegmentSeconds, type LapLike } from './best-segment';

export interface PrBucket {
  key: string;
  label: string;
  meters: number;
  tolerance: number;
}

export const PR_BUCKETS: PrBucket[] = [
  { key: '5k', label: '5K', meters: 5000, tolerance: 0.06 }, // 4.70–5.30 km
  { key: '10k', label: '10K', meters: 10000, tolerance: 0.05 }, // 9.5–10.5 km
  { key: 'hm', label: 'Half Marathon', meters: 21097, tolerance: 0.04 }, // ~20.25–21.94 km
  { key: 'fm', label: 'Marathon', meters: 42195, tolerance: 0.03 }, // ~40.9–43.5 km
];

// Runs only — exclude walks/other; matches the sync-time run-type filter.
export const PR_RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];

export interface RunActivityRow {
  id?: string;
  activity_name?: string | null;
  activity_type?: string | null;
  start_time: string;
  distance: number;
  duration: number;
  /**
   * The activity's laps, when the caller selected them. OPTIONAL on purpose:
   * supplying them upgrades the bucket search from "was this whole run a 5K?" to
   * "was there a 5K inside this run?" (see best-segment.ts), and every caller
   * that doesn't need that keeps a cheap query. The result is only ever more
   * accurate, never less, so the two kinds of caller cannot disagree about
   * whether a PR is real — only about whether they can see it.
   */
  laps?: LapLike[] | null;
}

/** Runs that count toward a PR bucket: real distance/duration, run-type only. */
export function filterQualifyingRuns<T extends RunActivityRow>(acts: T[]): T[] {
  return acts.filter(
    (a) => a.distance > 0 && a.duration > 0 && (!a.activity_type || PR_RUN_TYPES.includes(a.activity_type)),
  );
}

export interface DistanceBest {
  key: string;
  label: string;
  meters: number;
  seconds: number | null;
  date: string | null;
  activityName: string | null;
  /** Present only when the source rows included `id` (award-engine needs this; the display route doesn't). */
  activityId: string | null;
  /**
   * The best was a continuous stretch measured INSIDE a longer run, rather than
   * the whole run scaled to the bucket distance. Worth surfacing: "5K in 20:06"
   * taken out of a 21 km run is a fact about a run the reader may not recognise
   * from its name, and the first question is always "which run?".
   */
  fromSegment: boolean;
  /** How long the run it came out of was, in metres — context for `fromSegment`. */
  sourceMeters: number | null;
}

/**
 * Fastest qualifying effort per bucket.
 *
 * Two ways a run can supply one, best of both:
 *
 *  1. A continuous segment inside it, when the row carries `laps`. Exact
 *     distance, no scaling. See best-segment.ts for why this had to exist.
 *  2. The whole run, scaled to the bucket distance, when it lands in the
 *     tolerance window. Kept as the fallback because most rows have no laps
 *     stored yet (the laps backfill drains on a cron), and it is the only way a
 *     4.95 km run can register as a 5K at all.
 *
 * (1) beats (2) on the same run whenever both exist, because scaling a whole run
 * charges the target distance at the run's AVERAGE pace — on a long run that is
 * a warm-up and a cool-down averaged into a race effort.
 */
export function computeDistanceBests<T extends RunActivityRow>(runs: T[]): DistanceBest[] {
  return PR_BUCKETS.map((b) => {
    const lo = b.meters * (1 - b.tolerance);
    const hi = b.meters * (1 + b.tolerance);
    let best:
      | { seconds: number; date: string; name: string | null; id: string | null; fromSegment: boolean; sourceMeters: number }
      | null = null;

    for (const r of runs) {
      const segment = r.distance >= b.meters ? bestSegmentSeconds(r.laps, b.meters) : null;
      let seconds: number | null = segment;
      let fromSegment = segment !== null;

      if (seconds === null) {
        if (r.distance < lo || r.distance > hi) continue;
        // Normalize to the exact bucket distance so a 5.2km run's "5K time" is
        // comparable (scale duration by the bucket/actual distance ratio).
        seconds = Math.round(r.duration * (b.meters / r.distance));
        fromSegment = false;
      }

      if (!best || seconds < best.seconds) {
        best = {
          seconds,
          date: r.start_time,
          name: r.activity_name ?? null,
          id: r.id ?? null,
          fromSegment,
          sourceMeters: r.distance,
        };
      }
    }

    return {
      key: b.key,
      label: b.label,
      meters: b.meters,
      seconds: best?.seconds ?? null,
      date: best?.date ?? null,
      activityName: best?.name ?? null,
      activityId: best?.id ?? null,
      fromSegment: best?.fromSegment ?? false,
      sourceMeters: best?.sourceMeters ?? null,
    };
  });
}
