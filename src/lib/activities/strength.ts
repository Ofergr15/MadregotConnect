/**
 * Strength training: the narrowed exercise-set shape we store, and the row both syncs write.
 * review-2026-11-20/strength/plan.md · flag `strength_training` (default off).
 *
 * Storage: `athlete_activities.exercise_sets` (jsonb, migration 203). Garmin only — Strava's
 * WeightTraining carries duration and HR, never sets.
 *
 * Garmin's `/activity-service/activity/{id}/exerciseSets` answers
 *   { exerciseSets: [{ setType: 'ACTIVE' | 'REST', exercises: [{ category, name, probability }],
 *                      repetitionCount, weight (grams), duration (s), startTime }] }
 * REST sets are dropped, and the most probable exercise names each set. An unrecognised
 * exercise keeps its category ('UNKNOWN' → null); the screen then says "תרגיל".
 */
import { STRENGTH_TYPE } from './kinds';

export interface StrengthSet {
  /** Garmin category, e.g. 'SQUAT', 'LUNGE', 'PLANK'; null when the watch couldn't tell. */
  category: string | null;
  /** Garmin exercise name inside the category, e.g. 'BARBELL_BACK_SQUAT'; null when unknown. */
  name: string | null;
  reps: number | null;
  /** Kilograms, one decimal. Null for bodyweight or when not recorded. */
  weightKg: number | null;
  /** Seconds — the set's own length (a plank is timed, a squat set has reps). */
  durationSec: number | null;
}

/** Sets fetched per athlete per sync, newest first — each is one extra Garmin call (like UPGRADES_PER_SYNC). */
export const STRENGTH_SETS_PER_SYNC = 5;

/** Most sets a session we store; a watch left recording in the gym should not write a megabyte. */
const MAX_SETS = 120;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v !== 'UNKNOWN' ? v.trim() : null;
}
function pos(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function narrowExerciseSets(raw: unknown): StrengthSet[] | null {
  const list = (raw as { exerciseSets?: unknown } | null)?.exerciseSets;
  if (!Array.isArray(list)) return null;
  const out: StrengthSet[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const set = s as Record<string, unknown>;
    if (set.setType !== 'ACTIVE') continue;
    const exercises = Array.isArray(set.exercises) ? (set.exercises as Array<Record<string, unknown>>) : [];
    const best = [...exercises].sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0))[0];
    const grams = pos(set.weight);
    out.push({
      category: str(best?.category),
      name: str(best?.name),
      reps: pos(set.repetitionCount) != null ? Math.round(set.repetitionCount as number) : null,
      weightKg: grams != null ? Math.round(grams / 100) / 10 : null,
      durationSec: pos(set.duration) != null ? Math.round(set.duration as number) : null,
    });
    if (out.length >= MAX_SETS) break;
  }
  return out;
}

/** How many exercises a session had: consecutive sets of the same exercise are one. */
export function exerciseCount(sets: StrengthSet[] | null | undefined): number {
  if (!sets?.length) return 0;
  let n = 0; let prev = '';
  for (const s of sets) {
    const key = `${s.category ?? '?'}|${s.name ?? '?'}`;
    if (key !== prev) { n += 1; prev = key; }
  }
  return n;
}

export interface StrengthRowInput {
  athleteId: string;
  source: 'garmin' | 'strava';
  garminActivityId: number;          // Strava rows: -stravaId, as the run rows do
  stravaActivityId?: number | null;
  name: string | null;
  startTimeLocal: string;
  durationSec: number;
  averageHr: number | null;
  maxHr: number | null;
  calories: number | null;
  sets?: StrengthSet[] | null;
}

/**
 * The row a strength session writes. distance 0 and average_pace null on purpose:
 * a km reader that forgot the type filter adds nothing, and nothing divides by distance.
 */
export function strengthRow(i: StrengthRowInput): Record<string, unknown> {
  return {
    athlete_id: i.athleteId,
    garmin_activity_id: i.garminActivityId,
    ...(i.stravaActivityId != null ? { strava_activity_id: i.stravaActivityId } : {}),
    source: i.source,
    activity_name: i.name || 'אימון כוח',
    activity_type: STRENGTH_TYPE,
    start_time: i.startTimeLocal,
    distance: 0,
    duration: Math.round(i.durationSec),
    average_pace: null,
    average_hr: i.averageHr != null ? Math.round(i.averageHr) : null,
    max_hr: i.maxHr != null ? Math.round(i.maxHr) : null,
    calories: i.calories || null,
    has_polyline: false,
    ...(i.sets ? { exercise_sets: i.sets } : {}),
  };
}

/** Postgres "column does not exist" — migration 203 not pasted yet: write the row without the sets. */
export function isMissingExerciseSetsColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === '42703' || /exercise_sets/.test(error.message || ''));
}
