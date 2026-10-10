import { createHash } from 'crypto';
import { findCrossSourceDuplicate } from '@/lib/activity-dedup';
import type { ParsedStream } from '@/lib/garmin/streams';
import { saveActivityStream } from '@/lib/garmin/stream-store';
import { UUID_RE } from './http';
import type { Db } from './types';

/**
 * One finished Apple Watch run, uploaded by the companion app, into
 * `athlete_activities` — the same table, the same conventions, and the same
 * twin rules every other source already obeys.
 *
 * The rules that matter, in order:
 *
 *  1. **Idempotent on HKWorkout.uuid.** The app re-sends on every wake until it
 *     gets a 2xx, and HealthKit can deliver a route AFTER the workout (Apple's
 *     "Reading route data": routes may arrive late or be replaced). So a repeat
 *     upload is answered `duplicate` — and if it now carries a route or laps the
 *     stored row lacks, those are added, never overwritten.
 *  2. **Cross-source twins** (`findCrossSourceDuplicate`, the same 15 min /
 *     10 % / 80 %-overlap test as Garmin↔Strava):
 *       - a STRAVA twin is upgraded in place to the Apple recording — the watch
 *         knows the laps and HR, Strava's export doesn't — keeping the row id
 *         (feed item, kudos, comments) and `strava_activity_id` (so the Strava
 *         sync keeps recognising it and never re-imports it);
 *       - a GARMIN (or another Apple) twin wins: the upload is skipped and the
 *         twin's id returned. No double counting either way.
 *  3. **Convention A for `start_time`**: the athlete's local wall clock stored as
 *     if it were UTC — what Garmin's `startTimeLocal` and Strava's
 *     `start_date_local` both write, and what `activityLocalDateStr` reads.
 *  4. **`garmin_activity_id` is NOT NULL and UNIQUE per athlete** (it predates
 *     every other source). Strava uses `-strava_id`; Apple uses
 *     `-(2^52 + 48 bits of its hash)` — negative, disjoint from Strava's range,
 *     and inside JS's safe integers, so every reader that keys on it (feed
 *     links, the workout-watch teaser) works unchanged.
 */

export const APPLE_ACTIVITY_SCHEMA = 'madregot.apple-activity';
export const APPLE_SOURCE = 'apple';
export const DEFAULT_TIME_ZONE = 'Asia/Jerusalem';

const MAX_ROUTE_POINTS = 20_000;
const MAX_HR_SAMPLES = 50_000;
const MAX_LAPS = 500;
const STORED_GPS_POINTS = 5_000;

export interface AppleLapV1 {
  startOffsetS: number;
  durationS: number;
  distanceM: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadence?: number | null;
  avgPower?: number | null;
  elevationGainM?: number | null;
}

export interface AppleRoutePointV1 { t: number; lat: number; lng: number; alt?: number | null }
export interface AppleHrSampleV1 { t: number; bpm: number }

export interface AppleActivityUploadV1 {
  schema?: typeof APPLE_ACTIVITY_SCHEMA;
  version?: 1;
  appleWorkoutUuid: string;
  workoutPlanId: string | null;
  startDate: string;
  endDate: string;
  timeZone: string;
  indoor: boolean;
  name: string | null;
  distanceM: number;
  durationS: number;
  energyKcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  avgCadence: number | null;
  laps: AppleLapV1[];
  route: AppleRoutePointV1[];
  heartRate: AppleHrSampleV1[];
}

type Validated = { ok: true; upload: AppleActivityUploadV1 } | { ok: false; error: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

function validTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function validateAppleUpload(body: Record<string, unknown>): Validated {
  if (body.schema !== undefined && body.schema !== APPLE_ACTIVITY_SCHEMA) return { ok: false, error: 'unknown schema' };
  if (body.version !== undefined && body.version !== 1) return { ok: false, error: 'unsupported version' };
  const uuid = typeof body.appleWorkoutUuid === 'string' ? body.appleWorkoutUuid.trim().toLowerCase() : '';
  if (!UUID_RE.test(uuid)) return { ok: false, error: 'appleWorkoutUuid must be a UUID' };
  const plan = typeof body.workoutPlanId === 'string' ? body.workoutPlanId.trim().toLowerCase() : null;
  if (plan && !UUID_RE.test(plan)) return { ok: false, error: 'workoutPlanId must be a UUID' };

  const start = typeof body.startDate === 'string' ? Date.parse(body.startDate) : NaN;
  const end = typeof body.endDate === 'string' ? Date.parse(body.endDate) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false, error: 'startDate/endDate invalid' };
  if (end - start > 48 * 3600_000) return { ok: false, error: 'workout longer than 48h' };
  if (start > Date.now() + 10 * 60_000) return { ok: false, error: 'workout in the future' };

  const distanceM = num(body.distanceM);
  const durationS = num(body.durationS);
  if (distanceM == null || distanceM < 0 || distanceM > 400_000) return { ok: false, error: 'distanceM invalid' };
  if (durationS == null || durationS <= 0 || durationS > 48 * 3600) return { ok: false, error: 'durationS invalid' };

  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const route = arr(body.route);
  const heartRate = arr(body.heartRate);
  const laps = arr(body.laps);
  if (route.length > MAX_ROUTE_POINTS || heartRate.length > MAX_HR_SAMPLES || laps.length > MAX_LAPS) {
    return { ok: false, error: 'too many samples' };
  }

  return {
    ok: true,
    upload: {
      schema: APPLE_ACTIVITY_SCHEMA,
      version: 1,
      appleWorkoutUuid: uuid,
      workoutPlanId: plan,
      startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(),
      timeZone: validTimeZone(body.timeZone),
      indoor: body.indoor === true,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null,
      distanceM,
      durationS,
      energyKcal: pos(body.energyKcal),
      avgHr: pos(body.avgHr),
      maxHr: pos(body.maxHr),
      elevationGainM: num(body.elevationGainM),
      avgCadence: pos(body.avgCadence),
      laps: laps
        .map((l: any) => ({
          startOffsetS: num(l?.startOffsetS) ?? 0,
          durationS: num(l?.durationS) ?? 0,
          distanceM: num(l?.distanceM) ?? 0,
          avgHr: pos(l?.avgHr),
          maxHr: pos(l?.maxHr),
          avgCadence: pos(l?.avgCadence),
          avgPower: pos(l?.avgPower),
          elevationGainM: num(l?.elevationGainM),
        }))
        .filter((l) => l.durationS > 0),
      route: route
        .map((p: any) => ({ t: num(p?.t) ?? NaN, lat: num(p?.lat) ?? NaN, lng: num(p?.lng) ?? NaN, alt: num(p?.alt) }))
        .filter((p) => Number.isFinite(p.t) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0))
        .sort((a, b) => a.t - b.t),
      heartRate: heartRate
        .map((h: any) => ({ t: num(h?.t) ?? NaN, bpm: num(h?.bpm) ?? NaN }))
        .filter((h) => Number.isFinite(h.t) && h.bpm >= 25 && h.bpm <= 250)
        .sort((a, b) => a.t - b.t),
    },
  };
}

/** `2026-09-08T06:30:00Z` for an instant, read on the athlete's wall clock (Convention A). */
export function localWallClock(isoInstant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoInstant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`;
}

/**
 * The NOT NULL legacy key for an Apple row: -(2^52 + 48 bits of sha256(uuid)).
 * Hashed rather than sliced so two UUIDs sharing a prefix can't collide.
 */
export function syntheticGarminActivityId(uuid: string): number {
  const hex = createHash('sha256').update(uuid.toLowerCase()).digest('hex').slice(0, 12);
  return -(2 ** 52 + parseInt(hex, 16));
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestHr(samples: AppleHrSampleV1[], t: number, from: { i: number }): number | null {
  if (!samples.length) return null;
  while (from.i + 1 < samples.length && Math.abs(samples[from.i + 1].t - t) <= Math.abs(samples[from.i].t - t)) from.i++;
  return Math.abs(samples[from.i].t - t) <= 15 ? Math.round(samples[from.i].bpm) : null;
}

/**
 * The per-sample trace in the shape activity_streams already stores for Garmin
 * (lib/garmin/streams.ts): seconds, cumulative metres, cm/s, bpm, elevation.
 * Distance comes from the route, rescaled so its end agrees with the workout's
 * own total (GPS polylines run long on bends).
 */
export function buildAppleStream(upload: AppleActivityUploadV1): ParsedStream | null {
  const pts = upload.route;
  if (pts.length < 2) return null;
  const raw: number[] = [0];
  for (let i = 1; i < pts.length; i++) raw.push(raw[i - 1] + haversineM(pts[i - 1], pts[i]));
  const total = raw[raw.length - 1];
  const scale = total > 0 && upload.distanceM > 0 ? upload.distanceM / total : 1;
  const t = pts.map((p) => Math.round(p.t));
  const d = raw.map((x) => Math.round(x * scale * 10) / 10);
  const v = d.map((x, i) => (i === 0 ? 0 : Math.max(0, Math.round(((x - d[i - 1]) / Math.max(1, t[i] - t[i - 1])) * 100))));
  const cursor = { i: 0 };
  const hrSeries = upload.heartRate.length ? pts.map((p) => nearestHr(upload.heartRate, p.t, cursor)) : [];
  const hasHr = hrSeries.some((x) => x != null);
  const elev = pts.map((p) => (p.alt == null ? null : Math.round(p.alt * 10) / 10));
  const hasElev = elev.some((x) => x != null);
  const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  const series: ParsedStream['series'] = { t, d, v };
  const metrics = ['t', 'd', 'v'];
  if (hasHr) { series.hr = hrSeries.map((x) => x ?? 0); metrics.push('hr'); }
  if (hasElev) { series.elev = elev.map((x) => x ?? 0); metrics.push('elev'); }
  return { series, sampleCount: t.length, intervalSec: gaps[Math.floor(gaps.length / 2)] || 1, metrics };
}

function decimate<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const step = (list.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => list[Math.round(i * step)]);
}

/** The athlete_activities row for an Apple upload (an insert: every field, nulls included). */
export function buildAppleActivityRow(
  athleteId: string,
  u: AppleActivityUploadV1,
  extras: { shoeId?: string | null } = {},
): Record<string, unknown> {
  const gps = decimate(u.route, STORED_GPS_POINTS).map((p) => ({ lat: p.lat, lng: p.lng }));
  const first = u.route[0];
  const last = u.route.length > 1 ? u.route[u.route.length - 1] : null;
  const laps = u.laps.map((l, i) => ({
    distance: Math.round(l.distanceM),
    duration: Math.round(l.durationS),
    averagePace: l.distanceM > 0 ? Math.round(l.durationS / (l.distanceM / 1000)) : null,
    averageHR: l.avgHr != null ? Math.round(l.avgHr) : null,
    maxHR: l.maxHr != null ? Math.round(l.maxHr) : null,
    lapIndex: i + 1,
    ...(l.avgCadence != null ? { averageCadence: Math.round(l.avgCadence) } : {}),
    ...(l.avgPower != null ? { averagePower: Math.round(l.avgPower) } : {}),
    ...(l.elevationGainM != null ? { elevationGain: Math.round(l.elevationGainM) } : {}),
  }));
  return {
    athlete_id: athleteId,
    garmin_activity_id: syntheticGarminActivityId(u.appleWorkoutUuid),
    source: APPLE_SOURCE,
    apple_workout_uuid: u.appleWorkoutUuid,
    provider_plan_id: u.workoutPlanId,
    activity_name: u.name || 'ריצה',
    activity_type: u.indoor ? 'treadmill_running' : 'running',
    start_time: localWallClock(u.startDate, u.timeZone),
    distance: Math.round(u.distanceM),
    duration: Math.round(u.durationS),
    average_pace: u.distanceM > 0 ? Math.round(u.durationS / (u.distanceM / 1000)) : null,
    average_hr: u.avgHr != null ? Math.round(u.avgHr) : null,
    max_hr: u.maxHr != null ? Math.round(u.maxHr) : null,
    calories: u.energyKcal != null ? Math.round(u.energyKcal) : null,
    elevation_gain: u.elevationGainM != null ? Math.round(u.elevationGainM) : null,
    avg_cadence: u.avgCadence != null ? Math.round(u.avgCadence) : null,
    start_lat: first ? first.lat : null,
    start_lng: first ? first.lng : null,
    end_lat: last ? last.lat : null,
    end_lng: last ? last.lng : null,
    gps_points: gps,
    has_polyline: gps.length > 1,
    laps,
    lap_count: laps.length || null,
    shoe_id: extras.shoeId ?? null,
  };
}

/**
 * What may be written onto a Strava twin — `upgradePatch`'s rules
 * (lib/activity-dedup.ts) with Apple as the source: nothing null, no empty
 * route, never the athlete's own name, shoe, or athlete id.
 */
export function appleUpgradePatch(row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'athlete_id' || key === 'activity_name' || key === 'shoe_id' || key === 'garmin_activity_id') continue;
    if (value === null || value === undefined) continue;
    if (key === 'gps_points' && Array.isArray(value) && value.length === 0) continue;
    if (key === 'laps' && Array.isArray(value) && value.length === 0) continue;
    patch[key] = value;
  }
  if (!('gps_points' in patch)) delete patch.has_polyline;
  patch.source = APPLE_SOURCE;
  return patch;
}

/** On a repeat upload: only what the stored row is still missing. */
export function enrichmentPatch(stored: Record<string, any>, row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const gps = row.gps_points as unknown[];
  if (!stored.has_polyline && Array.isArray(gps) && gps.length > 1) {
    Object.assign(patch, { gps_points: gps, has_polyline: true, start_lat: row.start_lat, start_lng: row.start_lng, end_lat: row.end_lat, end_lng: row.end_lng });
  }
  const laps = row.laps as unknown[];
  if ((!Array.isArray(stored.laps) || stored.laps.length === 0) && Array.isArray(laps) && laps.length > 0) {
    Object.assign(patch, { laps, lap_count: row.lap_count });
  }
  if (stored.provider_plan_id == null && row.provider_plan_id) patch.provider_plan_id = row.provider_plan_id;
  for (const k of ['average_hr', 'max_hr', 'calories', 'elevation_gain', 'avg_cadence']) {
    if (stored[k] == null && row[k] != null) patch[k] = row[k];
  }
  return patch;
}

export type IngestStatus = 'inserted' | 'duplicate' | 'upgraded-strava' | 'skipped-twin';

export interface IngestResult {
  status: IngestStatus;
  activityId: string;
  twinSource?: string | null;
  enriched?: string[];
  match?: { workoutKey: string; matchMethod: string; weeklyPlanId: string } | null;
}

export interface IngestHooks {
  /** Plan matching; best-effort. Defaults to matchAthleteActivities. */
  match?: (db: Db, athleteId: string) => Promise<unknown>;
  /** Badges, challenges, shoe alerts; best-effort. */
  after?: (athleteId: string, shoeId: string | null) => Promise<void>;
  saveStream?: typeof saveActivityStream;
}

const STORED_COLS = 'id, has_polyline, laps, provider_plan_id, average_hr, max_hr, calories, elevation_gain, avg_cadence';

async function byUuid(db: Db, athleteId: string, uuid: string) {
  const { data } = await db
    .from('athlete_activities')
    .select(STORED_COLS)
    .eq('athlete_id', athleteId)
    .eq('apple_workout_uuid', uuid)
    .maybeSingle();
  return data as Record<string, any> | null;
}

async function readMatch(db: Db, activityId: string): Promise<IngestResult['match']> {
  try {
    const { data } = await db
      .from('activity_plan_matches')
      .select('workout_key, match_method, weekly_plan_id')
      .eq('activity_id', activityId)
      .maybeSingle();
    const m = data as { workout_key: string; match_method: string; weekly_plan_id: string } | null;
    return m ? { workoutKey: m.workout_key, matchMethod: m.match_method, weeklyPlanId: m.weekly_plan_id } : null;
  } catch {
    return null;
  }
}

export async function ingestAppleActivity(
  db: Db,
  athleteId: string,
  upload: AppleActivityUploadV1,
  hooks: IngestHooks = {},
): Promise<IngestResult> {
  const { data: athleteRow } = await db.from('athletes').select('active_shoe_id').eq('id', athleteId).maybeSingle();
  const shoeId = ((athleteRow as { active_shoe_id?: string | null } | null)?.active_shoe_id) ?? null;
  const row = buildAppleActivityRow(athleteId, upload, { shoeId });

  const finish = async (result: IngestResult, ranMatch: boolean): Promise<IngestResult> => {
    if (ranMatch) {
      try {
        await (hooks.match ?? (async (d, a) => (await import('@/lib/plans/match-athlete-activities')).matchAthleteActivities(d, a)))(db, athleteId);
      } catch (error) {
        console.warn(`Plan matching after Apple upload for ${athleteId} skipped:`, error);
      }
      try {
        await hooks.after?.(athleteId, shoeId);
      } catch {
        /* best-effort */
      }
    }
    return { ...result, match: await readMatch(db, result.activityId) };
  };

  // 1. Same workout already here.
  const existing = await byUuid(db, athleteId, upload.appleWorkoutUuid);
  if (existing) {
    const patch = enrichmentPatch(existing, row);
    const enriched = Object.keys(patch);
    if (enriched.length) {
      await db.from('athlete_activities').update(patch).eq('id', existing.id);
      await saveStream(db, hooks, existing.id, row, upload);
    }
    return finish({ status: 'duplicate', activityId: existing.id, enriched }, enriched.length > 0);
  }

  // 2. The same run from another source.
  const twin = await findCrossSourceDuplicate(db, athleteId, row.start_time as string, row.distance as number, row.duration as number);
  if (twin && twin.source === 'strava') {
    const { error } = await db.from('athlete_activities').update(appleUpgradePatch(row)).eq('id', twin.id);
    if (error) {
      // e.g. this uuid already landed on another row in a race: answer from that row.
      const raced = await byUuid(db, athleteId, upload.appleWorkoutUuid);
      if (raced) return finish({ status: 'duplicate', activityId: raced.id }, false);
      throw new Error(`Could not upgrade Strava twin: ${error.message}`);
    }
    await saveStream(db, hooks, twin.id, row, upload);
    return finish({ status: 'upgraded-strava', activityId: twin.id, twinSource: 'strava' }, true);
  }
  if (twin) {
    return finish({ status: 'skipped-twin', activityId: twin.id, twinSource: twin.source }, false);
  }

  // 3. New.
  let payload: Record<string, unknown> = row;
  let { data: inserted, error } = await db.from('athlete_activities').insert(payload).select('id').single();
  if (error && error.code === '23503' && payload.shoe_id) {
    // The active shoe was deleted mid-request (FK): keep the run, drop the shoe.
    payload = { ...payload, shoe_id: null };
    ({ data: inserted, error } = await db.from('athlete_activities').insert(payload).select('id').single());
  }
  if (error && error.code === '23505') {
    const raced = await byUuid(db, athleteId, upload.appleWorkoutUuid);
    if (raced) return finish({ status: 'duplicate', activityId: raced.id }, false);
  }
  if (error || !inserted) throw new Error(`Could not store Apple activity: ${error?.message || 'no row'}`);
  const activityId = (inserted as { id: string }).id;
  await saveStream(db, hooks, activityId, row, upload);
  return finish({ status: 'inserted', activityId }, true);
}

async function saveStream(db: Db, hooks: IngestHooks, activityId: string, row: Record<string, unknown>, upload: AppleActivityUploadV1) {
  try {
    // The trace only. activity_streams.laps holds Garmin lapDTOs verbatim and its
    // readers parse them as such; Apple's laps live on the row (StoredLap shape).
    const stream = buildAppleStream(upload);
    if (!stream) return;
    await (hooks.saveStream ?? saveActivityStream)(db, {
      activityId,
      garminActivityId: row.garmin_activity_id as number,
      source: APPLE_SOURCE,
      stream,
      laps: null,
    });
  } catch {
    /* the trace is evidence, not the run: never fail the upload over it */
  }
}
