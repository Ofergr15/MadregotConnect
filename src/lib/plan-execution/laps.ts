/**
 * Reading `athlete_activities.laps`.
 *
 * Its own module, and unit-tested, because this is where the feature's quietest
 * defect lived: a lap shape the reader didn't recognise produced no error and no
 * empty state — it produced a confident wrong percentage. Pure, so a test can
 * pin both shapes down without a database.
 */

import type { Lap } from '@/lib/academy/segments';

/**
 * Stored laps, normalised to what `matchLapsToSteps` wants.
 *
 * This column holds TWO different shapes, because two unrelated writers fill it
 * and neither converts:
 *
 *  - Garmin (api/garmin/activity-details, api/academy/segments) writes
 *    `{ distance, duration, averagePace }` — already this shape.
 *  - Strava (lib/strava/enrich.ts) writes the provider's raw `StravaLap`:
 *    `{ distance, moving_time, elapsed_time?, average_speed }` — no `duration`
 *    and no `averagePace` at all.
 *
 * Reading only the Garmin keys silently dropped every lap a Strava athlete had,
 * which cost them the rep-by-rep breakdown AND — worse — fell their score back to
 * distance alone: a confident "you nailed it" for an interval session run
 * entirely at the wrong pace. So both shapes are read.
 *
 * An empty array is a real value here — "already asked, no useful laps" — which
 * is why `hasStoredLaps` distinguishes it from a column nobody has filled yet.
 */
export function toLaps(value: unknown): Lap[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): Lap | null => {
      const lap = raw as {
        distance?: unknown; duration?: unknown; averagePace?: unknown;
        movingDuration?: unknown; moving_time?: unknown; elapsed_time?: unknown;
        average_speed?: unknown;
      };
      const distance = Number(lap?.distance);
      // Garmin's `duration`, else Strava's moving time (its own laps and the
      // per-km splits `splitsToLaps` synthesises both carry moving_time).
      const duration = [lap?.duration, lap?.movingDuration, lap?.moving_time, lap?.elapsed_time]
        .map((candidate) => Number(candidate))
        .find((candidate) => Number.isFinite(candidate) && candidate > 0);
      if (!Number.isFinite(distance) || distance <= 0 || duration == null) return null;

      // Pace: Garmin stores it, Strava gives m/s, otherwise derive it — the same
      // arithmetic the Garmin writer already does before storing.
      const stored = Number(lap?.averagePace);
      const speed = Number(lap?.average_speed);
      const averagePace = Number.isFinite(stored) && stored > 0
        ? stored
        : Number.isFinite(speed) && speed > 0
          ? Math.round(1000 / speed)
          : Math.round(duration / (distance / 1000));

      return { distance, duration, averagePace };
    })
    .filter((lap): lap is Lap => lap !== null);
}

/** Has anyone looked for this run's laps yet? `[]` means yes, and found none. */
export function hasStoredLaps(value: unknown): boolean {
  return Array.isArray(value);
}
