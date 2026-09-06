/**
 * The fastest continuous stretch of a given distance INSIDE one activity.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * PRs were computed from whole activities only: a run counted for the 5K bucket
 * if the run itself was 4.70–5.30 km. So a 5K run inside a longer run was
 * invisible, and for anyone who mostly runs long that made the short buckets
 * plainly wrong while the long ones stayed right — which is exactly how this was
 * reported. On Ofer's own history the displayed 10K PR was 47:24, taken from a
 * standalone 10.01 km run, while a 21.3 km run three weeks earlier contained a
 * continuous 10K in 40:15. Seven minutes, on the number the profile calls a
 * personal record.
 *
 * ── WHAT IT MEASURES ────────────────────────────────────────────────────────
 * A sliding window over the activity's laps. Every window that covers at least
 * the target distance is a candidate; the final lap is charged pro-rata for the
 * part of it actually needed, so a 5K window ending 300 m into a lap pays 300 m
 * of that lap's time. That interpolation assumes even pace WITHIN a single lap —
 * true enough for the 1 km auto-laps that dominate this data, and the only
 * assumption available without per-second streams.
 *
 * Deliberately requires FULL coverage: unlike the whole-activity fallback in
 * pr-buckets.ts, a segment is never scaled up from a shorter distance. A number
 * presented as a 10K time should be 10 km that were actually run consecutively.
 *
 * Coarser than Garmin's or Strava's own best-efforts, which use the second-by-
 * second stream and can therefore start a window mid-lap. This can only start on
 * a lap boundary, so it is CONSERVATIVE — never faster than the truth, which is
 * the right direction to be wrong about a personal record.
 */

/** One lap, as either provider writes it. Garmin: `duration`. Strava: `moving_time`. */
export interface LapLike {
  distance?: number | null;
  duration?: number | null;
  moving_time?: number | null;
  elapsed_time?: number | null;
}

/**
 * Seconds this lap took.
 *
 * The provider split matters: Strava laps carry BOTH moving_time and
 * elapsed_time, and on the same run stored twice (once from each provider) the
 * Garmin lap `duration` matches Strava's `moving_time` — 355.358 vs 355, against
 * an elapsed_time of 392. Reading elapsed_time first would have made every
 * Strava-sourced segment ~10% slower than the identical Garmin one, so the same
 * run would produce two different PRs depending on which sync won.
 */
function lapSeconds(lap: LapLike): number {
  const v = lap.duration ?? lap.moving_time ?? lap.elapsed_time;
  return typeof v === 'number' && v > 0 ? v : 0;
}

function lapMeters(lap: LapLike): number {
  const v = lap.distance;
  return typeof v === 'number' && v > 0 ? v : 0;
}

/**
 * Fastest continuous `targetMeters` inside these laps, in seconds — or null if
 * the laps never add up to the target (a 4 km run has no 5K in it) or carry no
 * usable distance/duration.
 */
export function bestSegmentSeconds(
  laps: LapLike[] | null | undefined,
  targetMeters: number,
): number | null {
  if (!Array.isArray(laps) || laps.length === 0 || targetMeters <= 0) return null;

  const usable: Array<{ m: number; s: number }> = [];
  for (const lap of laps) {
    const m = lapMeters(lap);
    const s = lapSeconds(lap);
    if (m > 0 && s > 0) usable.push({ m, s });
  }
  if (usable.length === 0) return null;

  let best: number | null = null;
  for (let i = 0; i < usable.length; i++) {
    let meters = 0;
    let seconds = 0;
    let reached = false;
    for (let j = i; j < usable.length; j++) {
      const lap = usable[j];
      if (meters + lap.m >= targetMeters) {
        // Pro-rata the part of this lap the window actually needs.
        const needed = targetMeters - meters;
        const total = seconds + lap.s * (needed / lap.m);
        if (best === null || total < best) best = total;
        reached = true;
        break;
      }
      meters += lap.m;
      seconds += lap.s;
    }
    // The tail from `i` to the end fell short, so every later start (a suffix of
    // it) falls short too. Nothing left to check.
    if (!reached) break;
  }

  return best === null ? null : Math.round(best);
}
