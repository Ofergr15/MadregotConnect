/**
 * The strength half of both syncs — kept OUT of the run pipeline on purpose. A strength
 * session has no trace, no laps, no splits, no plan-pace verdict, and must not fire the
 * "new run" pushes, teammate notifications, shoe mileage or plan matching the run path does.
 *
 * Gated per athlete on `strength_training` (default off): no flag, no row. So until a coach
 * turns it on, `athlete_activities` stays runs-only exactly as before — the km sweep
 * (lib/activities/kinds.ts) is the second line, not the only one.
 *
 * Garmin outranks Strava for the same session (CLAUDE.md "Garmin's copy wins — by upgrade"),
 * through the same dedup helpers the runs use, so the rule cannot drift.
 */
import type { createServerClient } from '@/lib/supabase/server';
import { findCrossSourceDuplicate, twinVerdict, upgradePatch } from '@/lib/activity-dedup';
import { isFeatureEnabled } from '@/lib/features/server';
import { STRENGTH_TYPE } from './kinds';
import {
  STRENGTH_OPTIONAL_COLUMNS, STRENGTH_SETS_PER_SYNC, hrFromDetails, isMissingExerciseSetsColumn, narrowExerciseSets, strengthRow,
  type StrengthHr, type StrengthRowInput, type StrengthSet,
} from './strength';

type Db = ReturnType<typeof createServerClient>;

export interface GarminStrengthActivity {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  duration: number;
  averageHR: number | null;
  maxHR: number | null;
  calories: number;
  aerobicTrainingEffect?: number | null;
  anaerobicTrainingEffect?: number | null;
  trainingEffectLabel?: string | null;
  activityTrainingLoad?: number | null;
}

function teOf(a: GarminStrengthActivity): StrengthRowInput['trainingEffect'] {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const te = { aerobic: num(a.aerobicTrainingEffect), anaerobic: num(a.anaerobicTrainingEffect),
    label: typeof a.trainingEffectLabel === 'string' ? a.trainingEffectLabel : null, load: num(a.activityTrainingLoad) };
  return te.aerobic == null && te.anaerobic == null && te.load == null ? null : te;
}

export interface StrengthSyncResult { inserted: number; upgraded: number; setsFetched: number }

/** Insert, or (Garmin over a Strava twin) upgrade in place. Retries without the optional columns before migration 210. */
async function writeRow(db: Db, row: Record<string, unknown>, twinId: string | null): Promise<'inserted' | 'upgraded' | 'failed'> {
  const run = async (r: Record<string, unknown>) => twinId
    ? db.from('athlete_activities').update(upgradePatch(r)).eq('id', twinId)
    : db.from('athlete_activities').insert(r);
  let { error } = await run(row);
  if (error && isMissingExerciseSetsColumn(error)) {
    const without = { ...row };
    for (const c of STRENGTH_OPTIONAL_COLUMNS) delete without[c];
    ({ error } = await run(without));
  }
  if (error) { console.error('strength sync write failed', error.message); return 'failed'; }
  return twinId ? 'upgraded' : 'inserted';
}

/**
 * Garmin: the strength sessions in this sync's activity list. Sets are fetched for the newest
 * STRENGTH_SETS_PER_SYNC new sessions only (one extra call each, under the route's 300 s ceiling);
 * older ones are stored without sets and keep that answer — a later backfill can fill them.
 */
export async function syncGarminStrength(
  db: Db,
  athleteId: string,
  activities: GarminStrengthActivity[],
  fetchSets: (activityId: number) => Promise<unknown>,
  fetchDetails?: (activityId: number) => Promise<unknown>,
): Promise<StrengthSyncResult> {
  const out: StrengthSyncResult = { inserted: 0, upgraded: 0, setsFetched: 0 };
  if (!activities.length || !(await isFeatureEnabled('strength_training', athleteId, db))) return out;

  const { data: existing } = await db.from('athlete_activities').select('garmin_activity_id')
    .eq('athlete_id', athleteId).in('garmin_activity_id', activities.map(a => a.activityId));
  const known = new Set((existing || []).map((e: { garmin_activity_id: number }) => e.garmin_activity_id));
  const fresh = activities.filter(a => !known.has(a.activityId))
    .sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal));

  for (const [i, a] of fresh.entries()) {
    let sets: StrengthSet[] | null = null;
    let hr: StrengthHr | null = null;
    if (i < STRENGTH_SETS_PER_SYNC) {
      try { sets = narrowExerciseSets(await fetchSets(a.activityId)); out.setsFetched += 1; } catch { sets = null; }
      if (fetchDetails) { try { hr = hrFromDetails(await fetchDetails(a.activityId)); } catch { hr = null; } }
    }
    const input: StrengthRowInput = {
      athleteId, source: 'garmin', garminActivityId: a.activityId, name: a.activityName, startTimeLocal: a.startTimeLocal,
      durationSec: a.duration, averageHr: a.averageHR, maxHr: a.maxHR, calories: a.calories || null, sets,
      trainingEffect: teOf(a), hr,
    };
    const twin = await findCrossSourceDuplicate(db, athleteId, a.startTimeLocal, 0, a.duration);
    const verdict = twinVerdict(twin);
    if (verdict === 'skip') continue;
    const r = await writeRow(db, strengthRow(input), verdict === 'upgrade' ? twin!.id : null);
    if (r === 'inserted') out.inserted += 1;
    if (r === 'upgraded') out.upgraded += 1;
  }
  return out;
}

export interface StravaStrengthActivity {
  id: number;
  name: string | null;
  start_date_local: string;
  moving_time?: number | null;
  elapsed_time?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  calories?: number | null;
  suffer_score?: number | null;
}

/** Strava: duration + HR only. Skipped when Garmin already has the session (Garmin wins). */
export async function syncStravaStrength(db: Db, athleteId: string, activities: StravaStrengthActivity[]): Promise<number> {
  if (!activities.length || !(await isFeatureEnabled('strength_training', athleteId, db))) return 0;
  const { data: existing } = await db.from('athlete_activities').select('strava_activity_id')
    .eq('athlete_id', athleteId).in('strava_activity_id', activities.map(a => a.id));
  const known = new Set((existing || []).map((e: { strava_activity_id: number }) => e.strava_activity_id));
  let inserted = 0;
  for (const a of activities) {
    if (known.has(a.id)) continue;
    const duration = a.moving_time || a.elapsed_time || 0;
    if (duration <= 0) continue;
    if (await findCrossSourceDuplicate(db, athleteId, a.start_date_local, 0, duration)) continue;
    const row = strengthRow({
      athleteId, source: 'strava', garminActivityId: -a.id, stravaActivityId: a.id, name: a.name, startTimeLocal: a.start_date_local,
      durationSec: duration, averageHr: a.average_heartrate ?? null, maxHr: a.max_heartrate ?? null, calories: a.calories ?? null,
      sufferScore: typeof a.suffer_score === 'number' ? a.suffer_score : null,
    });
    if ((await writeRow(db, row, null)) === 'inserted') inserted += 1;
  }
  return inserted;
}

export { STRENGTH_TYPE };
