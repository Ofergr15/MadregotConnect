/**
 * Garmin's `/activity/{id}/splits` lapDTOs, on the way into the database.
 *
 * `athlete_activities.laps` is jsonb, so what gets kept is a decision about what
 * questions can ever be answered — not a schema change. The response carries 36
 * fields and this used to keep three, which threw away the two that settle
 * planned-vs-executed outright:
 *
 *  - **`wktStepIndex`** — the step of the pushed workout this lap executed. When an
 *    athlete starts the scheduled workout on the watch, Garmin stamps every lap with
 *    the step it belongs to, so "which part of the plan is this?" stops being a
 *    search over the distance axis and becomes a lookup. On the published Sunday
 *    session one athlete's laps read step 0 = 2 km warm-up, step 1 = the 20 km block
 *    as a single lap, steps 2/3 = eight strides and their recoveries.
 *  - **`intensityType`** — WARMUP / ACTIVE / INTERVAL / REST / RECOVERY / COOLDOWN.
 *    Trustworthy only alongside `wktStepIndex`: a plain run on 1 km auto-lap comes
 *    back with every lap labelled INTERVAL, which means nothing at all.
 *
 * Plus the ones that make a verdict fairer or richer: grade-adjusted pace (a block
 * run uphill is not a slower block), per-lap HR (the only evidence that a `no_target`
 * stride was actually hard), cadence and elevation.
 *
 * Optional fields are written only when present. A 40-lap run stored for 26 athletes
 * is a lot of jsonb, and `"wktStepIndex": null` on every lap of every plain run buys
 * nothing — `undefined` is dropped by `JSON.stringify` on the way to Postgres.
 */

/** What gets stored per lap. The first five have always been here; the rest are new. */
export interface StoredLap {
  distance: number;
  duration: number;
  averagePace: number | null;
  averageHR: number | null;
  maxHR: number | null;
  /** The watch's own lap number, 1-based. */
  lapIndex?: number;
  /**
   * Which step of the structured workout this lap executed. Absent unless the athlete
   * started a workout from the watch.
   *
   * It indexes the step list of the workout **as the device had it** — flat, and
   * INCLUDING the repeat markers, which occupy an index each and never run. So it is
   * only readable against that same list, which `GET /activity/{id}/workouts` returns;
   * see `garmin/executed-workout.ts`. Reading it against our own parsed plan, where
   * repeats are containers and the athlete may have run a workout we never wrote, names
   * a different step than the watch meant and does it silently.
   */
  wktStepIndex?: number;
  /** Garmin's per-lap marker. Only meaningful when `wktStepIndex` is set. */
  intensityType?: string;
  /** sec/km with the gradient taken out — a fair number for a hilly block. */
  gradeAdjustedPace?: number;
  /** Steps per minute (Garmin's `averageRunCadence`, both legs). */
  averageCadence?: number;
  elevationGain?: number;
  elevationLoss?: number;
  /** Time actually moving, when it differs from `duration` (auto-pause, walk breaks). */
  movingDuration?: number;
}

/** Drop the key entirely when there's no value, rather than storing a null. */
const num = (v: unknown, round = true): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return round ? Math.round(n) : n;
};

/** Garmin reports grade-adjusted *speed* in m/s; every reader here wants sec/km. */
const paceFromSpeed = (speed: unknown): number | undefined => {
  const v = Number(speed);
  return Number.isFinite(v) && v > 0 ? Math.round(1000 / v) : undefined;
};

/**
 * Narrow lapDTOs for `athlete_activities.laps`, matching what
 * `GET /api/garmin/activity-details` already writes so the two writers agree.
 *
 * `duration` prefers the lap's own elapsed duration over moving duration: a
 * 15-second stride followed by a 45-second walk is two laps whose moving time is
 * the whole of them, and an auto-pause on a walk break would otherwise make the
 * recovery lap look shorter than it was. `movingDuration` is kept alongside it when
 * the two disagree, so a reader can tell a walk break from a stop.
 */
export function narrowLaps(lapDTOs: unknown): StoredLap[] {
  if (!Array.isArray(lapDTOs)) return [];
  const out: StoredLap[] = [];
  for (const lap of lapDTOs) {
    const l = lap as Record<string, any>;
    const distance = Number(l?.distance) || 0;
    const duration = Number(l?.duration ?? l?.elapsedDuration ?? l?.movingDuration) || 0;
    if (duration <= 0) continue;
    const moving = num(l?.movingDuration);
    out.push({
      distance,
      duration,
      averagePace: distance > 0 ? Math.round(duration / (distance / 1000)) : null,
      averageHR: num(l?.averageHR) ?? null,
      maxHR: num(l?.maxHR) ?? null,
      lapIndex: num(l?.lapIndex),
      // Zero is a real step index (the warm-up), so this cannot be truthiness-tested.
      wktStepIndex: num(l?.wktStepIndex),
      intensityType: typeof l?.intensityType === 'string' ? l.intensityType : undefined,
      gradeAdjustedPace: distance > 0 ? paceFromSpeed(l?.avgGradeAdjustedSpeed) : undefined,
      averageCadence: num(l?.averageRunCadence),
      elevationGain: num(l?.elevationGain),
      elevationLoss: num(l?.elevationLoss),
      movingDuration: moving != null && moving !== Math.round(duration) ? moving : undefined,
    });
  }
  return out;
}

/**
 * Stored laps, whatever shape they were written in, on the way back OUT.
 *
 * `athlete_activities.laps` is jsonb with no schema and three writers have filled it
 * over time: Garmin's narrow shape (`duration`), a raw-DTO passthrough
 * (`movingDuration` / `elapsedDuration`), and Strava's splits (`moving_time` /
 * `elapsed_time`). A reader that knows only the Garmin keys silently returns a lap
 * with `duration: 0` for every Strava athlete — which the grading engine can't tell
 * apart from a run with no markers, so those athletes' interval sessions came back
 * "the laps can't show the work" no matter what they ran.
 *
 * Zero-duration laps are dropped rather than kept at 0: a lap with distance and no
 * time is an infinite pace, and every consumer here divides by it.
 */
export function normalizeStoredLaps(raw: unknown): StoredLap[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredLap[] = [];
  for (const lap of raw) {
    const l = lap as Record<string, any>;
    if (!l || typeof l !== 'object') continue;
    const distance = Number(l.distance) || 0;
    const duration = Number(
      l.duration ?? l.movingDuration ?? l.elapsedDuration ?? l.moving_time ?? l.elapsed_time,
    ) || 0;
    if (duration <= 0) continue;
    const averagePace = l.averagePace != null
      ? Number(l.averagePace)
      : distance > 0 ? Math.round(duration / (distance / 1000)) : null;
    out.push({
      distance,
      duration,
      averagePace,
      averageHR: num(l.averageHR ?? l.average_heartrate) ?? null,
      maxHR: num(l.maxHR ?? l.max_heartrate) ?? null,
      // Strava numbers its laps `lap_index`; Garmin `lapIndex`.
      lapIndex: num(l.lapIndex ?? l.lap_index ?? l.split),
      wktStepIndex: num(l.wktStepIndex),
      intensityType: typeof l.intensityType === 'string' ? l.intensityType : undefined,
      // Either already-narrowed sec/km, or a raw DTO's m/s still to be converted.
      gradeAdjustedPace: num(l.gradeAdjustedPace)
        ?? (distance > 0 ? paceFromSpeed(l.avgGradeAdjustedSpeed) : undefined),
      // Strava's `average_cadence` for a run is one leg per minute against Garmin's
      // two, and a number whose unit depends on the provider is worse than no number.
      averageCadence: num(l.averageCadence ?? l.averageRunCadence),
      elevationGain: num(l.elevationGain ?? l.total_elevation_gain),
      elevationLoss: num(l.elevationLoss),
      movingDuration: num(l.movingDuration ?? (l.moving_time != null && l.elapsed_time != null
        && l.moving_time !== l.elapsed_time ? l.moving_time : undefined)),
    });
  }
  return out;
}

/**
 * Is this lap set worth storing at all?
 *
 * A single lap is the activity itself — Garmin returns one lap for a run with no
 * markers, and storing it teaches the grading engine nothing while making
 * `laps IS NOT NULL` mean "we looked" instead of "we found something". The two
 * existing writers already both check `length > 1`; this is that rule, named.
 */
export function lapsWorthStoring(lapDTOs: unknown): boolean {
  return Array.isArray(lapDTOs) && lapDTOs.length > 1;
}
