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
}

/** Fastest qualifying run per bucket (normalized to the bucket's exact distance). */
export function computeDistanceBests<T extends RunActivityRow>(runs: T[]): DistanceBest[] {
  return PR_BUCKETS.map((b) => {
    const lo = b.meters * (1 - b.tolerance);
    const hi = b.meters * (1 + b.tolerance);
    let best: { seconds: number; date: string; name: string | null; id: string | null } | null = null;
    for (const r of runs) {
      if (r.distance < lo || r.distance > hi) continue;
      // Normalize to the exact bucket distance so a 5.2km run's "5K time" is
      // comparable (scale duration by the bucket/actual distance ratio).
      const normalized = r.duration * (b.meters / r.distance);
      if (!best || normalized < best.seconds) {
        best = {
          seconds: Math.round(normalized),
          date: r.start_time,
          name: r.activity_name ?? null,
          id: r.id ?? null,
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
    };
  });
}
