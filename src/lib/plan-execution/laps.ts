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
 *    `{ distance, duration, averagePace, … }` through `fromGarminLaps` below —
 *    already this shape. Rows cached before that existed carry only the three
 *    graded fields, or those plus HR, depending on which route got there first.
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
  return readStoredLaps(value).map(({ distance, duration, averagePace }) => ({
    distance, duration, averagePace,
  }));
}

/**
 * A stored lap with everything a reader might want off it, not just the three
 * fields the grader needs.
 *
 * The extras are what the splits table and the HR/elevation charts draw, and they
 * live here for one reason: the "which key holds this" knowledge above must exist
 * in exactly one place. A second reader that knew only Garmin's `duration` is how
 * the detail screen came to render 0:00 for every kilometre of every Garmin run.
 */
export interface StoredLap extends Lap {
  averagePace: number;
  averageHR: number | null;
  maxHR: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
}

/** Reads both stored shapes; see `toLaps` for what fills this column. */
export function readStoredLaps(value: unknown): StoredLap[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): StoredLap | null => {
      const lap = raw as {
        distance?: unknown; duration?: unknown; averagePace?: unknown;
        movingDuration?: unknown; moving_time?: unknown; elapsed_time?: unknown;
        average_speed?: unknown;
        averageHR?: unknown; average_heartrate?: unknown;
        maxHR?: unknown; max_heartrate?: unknown;
        elevationGain?: unknown; total_elevation_gain?: unknown;
        elevationLoss?: unknown;
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

      return {
        distance,
        duration,
        averagePace,
        averageHR: positive(lap?.averageHR, lap?.average_heartrate),
        maxHR: positive(lap?.maxHR, lap?.max_heartrate),
        // Elevation stays NULL when the lap never carried it, rather than 0: a
        // chart of zeroes claims the run was flat, which is a different statement
        // from "this run has no elevation data".
        elevationGain: finite(lap?.elevationGain, lap?.total_elevation_gain),
        elevationLoss: finite(lap?.elevationLoss),
      };
    })
    .filter((lap): lap is StoredLap => lap !== null);
}

/** First candidate that is a number at all (0 included — a flat km is real). */
function finite(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (candidate != null && Number.isFinite(value)) return value;
  }
  return null;
}

/** First candidate above zero — a heart rate of 0 is a missing reading. */
function positive(...candidates: unknown[]): number | null {
  const value = finite(...candidates);
  return value != null && value > 0 ? value : null;
}

/**
 * Garmin's lap DTOs, in the shape this column stores — the one writer for it.
 *
 * The reader above knows how to read HR and elevation off a lap; for a long time
 * nothing wrote them. Two call sites each hand-mapped Garmin's `lapDTOs` and each
 * dropped a different set of fields (`api/academy/segments` kept only
 * distance/duration/pace, `api/garmin/activity-details` also kept HR), so the
 * elevation chart on the run detail was empty for every run in the club, and the
 * per-split HR chart was empty for whichever half of them the segments route had
 * cached first. Not missing from Garmin — never asked for on the way in.
 *
 * So writing this column goes through here, next to the reader, and the pair
 * can't drift: anything `readStoredLaps` looks for, this stores.
 *
 * Garmin's own keys are kept (`averagePace` being ours, derived) so the stored
 * jsonb still reads as a Garmin lap to anything that inspects it by hand.
 */
export function fromGarminLaps(lapData: unknown): StoredLap[] {
  if (!Array.isArray(lapData)) return [];
  return lapData
    .map((raw): StoredLap | null => {
      const lap = raw as Record<string, unknown>;
      const distance = Number(lap?.distance);
      const duration = finite(lap?.duration, lap?.movingDuration);
      if (!Number.isFinite(distance) || distance <= 0 || duration == null || duration <= 0) {
        return null;
      }
      return {
        distance,
        duration,
        averagePace: Math.round(duration / (distance / 1000)),
        averageHR: positive(lap?.averageHR),
        maxHR: positive(lap?.maxHR),
        elevationGain: finite(lap?.elevationGain),
        elevationLoss: finite(lap?.elevationLoss),
      };
    })
    .filter((lap): lap is StoredLap => lap !== null);
}

/** Has anyone looked for this run's laps yet? `[]` means yes, and found none. */
export function hasStoredLaps(value: unknown): boolean {
  return Array.isArray(value);
}
