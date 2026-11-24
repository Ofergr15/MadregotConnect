/**
 * Strength training: the narrowed exercise-set shape we store, and the row both syncs write.
 * review-2026-11-20/strength/plan.md · flag `strength_training` (default off).
 *
 * Storage: `athlete_activities.exercise_sets` (jsonb, migration 210). Garmin only — Strava's
 * WeightTraining carries duration and HR, never sets.
 *
 * Garmin's `/activity-service/activity/{id}/exerciseSets` answers
 *   { exerciseSets: [{ setType: 'ACTIVE' | 'REST', exercises: [{ category, name, probability }],
 *                      repetitionCount, weight (grams), duration (s), startTime }] }
 * REST sets are kept as `kind: 'rest'` (no exercise, no reps) so the detail can draw work vs
 * rest on the HR chart; every count (exercises, sets, volume) reads ACTIVE sets only — rows
 * written before `kind` existed have no rest sets and read as active. The most probable
 * exercise names each set. An unrecognised exercise keeps its category ('UNKNOWN' → null);
 * the screen then says "תרגיל".
 */
import { STRENGTH_TYPE } from './kinds';

export interface StrengthSet {
  /** 'active' = a set; 'rest' = the pause after it. Missing on rows from before rest sets were kept → active. */
  kind?: 'active' | 'rest';
  /** Garmin's set start, as sent (UTC ISO); lets the chart place the set on the HR trace. */
  startTime?: string | null;
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
    const kind = set.setType === 'ACTIVE' ? 'active' : set.setType === 'REST' ? 'rest' : null;
    if (!kind) continue;
    const startTime = typeof set.startTime === 'string' ? set.startTime : null;
    if (kind === 'rest') {
      out.push({ kind, startTime, category: null, name: null, reps: null, weightKg: null,
        durationSec: pos(set.duration) != null ? Math.round(set.duration as number) : null });
      if (out.length >= MAX_SETS) break;
      continue;
    }
    const exercises = Array.isArray(set.exercises) ? (set.exercises as Array<Record<string, unknown>>) : [];
    const best = [...exercises].sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0))[0];
    const grams = pos(set.weight);
    out.push({
      kind, startTime,
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

/** The work sets only — what every count reads. */
export function activeSets(sets: StrengthSet[] | null | undefined): StrengthSet[] {
  return (sets || []).filter(s => s.kind !== 'rest');
}

/** How many exercises a session had: consecutive sets of the same exercise are one. */
export function exerciseCount(sets: StrengthSet[] | null | undefined): number {
  const act = activeSets(sets);
  if (!act.length) return 0;
  let n = 0; let prev = '';
  for (const s of act) {
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
  /** Garmin: { aerobic, anaerobic, label, load } — same shape the run sync writes (migration 160). */
  trainingEffect?: { aerobic: number | null; anaerobic: number | null; label: string | null; load: number | null } | null;
  /** Strava Relative Effort (`suffer_score`). */
  sufferScore?: number | null;
  /** Compact HR trace for the detail chart. */
  hr?: StrengthHr | null;
}

/** HR over the session: seconds from start + bpm, downsampled. Garmin only. */
export interface StrengthHr { t: number[]; hr: number[] }

/** Seconds between kept HR samples — 48 min ≈ 580 points, enough for a phone-width chart. */
export const HR_STEP_SEC = 5;

/**
 * Pull the HR trace out of Garmin's activity details (metricDescriptors + activityDetailMetrics).
 * Strength has no distance axis, so lib/garmin/streams' parser (which needs one) does not apply.
 */
export function hrFromDetails(details: unknown): StrengthHr | null {
  const d = details as { metricDescriptors?: Array<{ key?: string; metricsIndex?: number }>; activityDetailMetrics?: Array<{ metrics?: unknown[] }> } | null;
  const desc = d?.metricDescriptors; const rows = d?.activityDetailMetrics;
  if (!Array.isArray(desc) || !Array.isArray(rows)) return null;
  const idx = (k: string) => desc.find(m => m?.key === k)?.metricsIndex;
  const hi = idx('directHeartRate'); const ti = idx('sumElapsedDuration') ?? idx('sumDuration'); const tsi = idx('directTimestamp');
  if (hi == null || (ti == null && tsi == null)) return null;
  const t: number[] = []; const hr: number[] = [];
  let t0: number | null = null; let lastKept = -Infinity;
  for (const r of rows) {
    const m = r?.metrics; if (!Array.isArray(m)) continue;
    const bpm = m[hi]; if (typeof bpm !== 'number' || bpm <= 0) continue;
    let sec: number | null = null;
    if (ti != null && typeof m[ti] === 'number') sec = m[ti] as number;
    else if (tsi != null && typeof m[tsi] === 'number') { const ms = m[tsi] as number; if (t0 == null) t0 = ms; sec = (ms - t0) / 1000; }
    if (sec == null || sec - lastKept < HR_STEP_SEC) continue;
    lastKept = sec; t.push(Math.round(sec)); hr.push(Math.round(bpm));
  }
  return t.length >= 2 ? { t, hr } : null;
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
    ...(i.trainingEffect ? { training_effect: i.trainingEffect } : {}),
    ...(i.sufferScore != null ? { suffer_score: Math.round(i.sufferScore) } : {}),
    ...(i.hr ? { strength_hr: i.hr } : {}),
  };
}

/** Columns a strength row may carry that a not-yet-migrated DB lacks (210: exercise_sets/strength_hr/suffer_score; 160: training_effect). */
export const STRENGTH_OPTIONAL_COLUMNS = ['exercise_sets', 'strength_hr', 'suffer_score', 'training_effect'] as const;

/** Postgres "column does not exist" — migration 210 not pasted yet: write the row without the sets. */
export function isMissingExerciseSetsColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /exercise_sets|strength_hr|suffer_score|training_effect/.test(error.message || ''));
}
