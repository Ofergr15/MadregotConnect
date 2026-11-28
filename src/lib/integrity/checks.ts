import { findStoredMatch, type StoredActivity } from '@/lib/activity-dedup';

/**
 * Read-only data-integrity checks (task 66). Pure: every function takes rows the
 * caller already fetched and returns findings. Nothing here writes, and the script
 * that feeds it (scripts/integrity-check.mts) only ever SELECTs.
 *
 * Findings carry ids, never names or emails, so a report can be pasted anywhere.
 */

export interface Finding {
  check: string;
  table: string;
  id: string;
  detail: string;
}

export interface ActivityRow extends StoredActivity {
  id: string;
  athlete_id: string | null;
  source: string | null;
}

export interface PlanRow {
  id: string;
  week_start_date: string | null;
  athlete_id: string | null;
  parsed_workouts?: unknown;
}

/** Rows whose `athlete_id` is null or names no athlete. `nullable` = a null is legitimate (group plans). */
export function orphanRows(
  table: string,
  rows: Array<{ id: string; athlete_id: string | null }>,
  athleteIds: ReadonlySet<string>,
  opts: { nullable?: boolean } = {},
): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (r.athlete_id == null) {
      if (!opts.nullable) out.push({ check: 'orphan', table, id: r.id, detail: 'athlete_id is null' });
    } else if (!athleteIds.has(r.athlete_id)) {
      out.push({ check: 'orphan', table, id: r.id, detail: `athlete_id ${r.athlete_id} not in athletes` });
    }
  }
  return out;
}

/**
 * Garmin + Strava copies of one run that both survived. Uses the SAME matcher the
 * sync uses (findStoredMatch), so this reports exactly what the importer would
 * have called a twin — a looser rule here would flag interval reps (see the 6×2 km
 * note in activity-dedup.ts).
 */
export function duplicateTwins(rows: ActivityRow[]): Finding[] {
  const byAthlete = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    if (!r.athlete_id || !r.start_time) continue;
    const list = byAthlete.get(r.athlete_id) || [];
    list.push(r);
    byAthlete.set(r.athlete_id, list);
  }
  const out: Finding[] = [];
  for (const list of byAthlete.values()) {
    const strava = list.filter((r) => r.source === 'strava');
    if (!strava.length) continue;
    for (const g of list) {
      if (g.source !== 'garmin' || !g.start_time) continue;
      const twin = findStoredMatch(strava, g.start_time, g.distance ?? 0, g.duration ?? null);
      if (twin) out.push({ check: 'duplicate-twin', table: 'athlete_activities', id: g.id, detail: `strava twin ${twin.id}` });
    }
  }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Plans whose dates cannot be right: a week_start_date that is not a real date, not
 * a Sunday (plan week = Sunday, CLAUDE.md), or wildly out of range; a workout whose
 * dayOfWeek is outside 0..6.
 */
export function impossiblePlanDates(rows: PlanRow[], now: Date = new Date()): Finding[] {
  const out: Finding[] = [];
  const max = new Date(now.getTime() + 366 * 86_400_000);
  for (const r of rows) {
    const d = r.week_start_date;
    const at = (detail: string) => out.push({ check: 'impossible-date', table: 'weekly_plans', id: r.id, detail });
    if (!d || !DATE.test(d)) { at(`week_start_date ${JSON.stringify(d)} is not a date`); continue; }
    const t = new Date(`${d}T12:00:00Z`);
    if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) { at(`week_start_date ${d} is not a real day`); continue; }
    if (t.getUTCDay() !== 0) at(`week_start_date ${d} is not a Sunday`);
    if (t.getUTCFullYear() < 2020 || t > max) at(`week_start_date ${d} is out of range`);
    const workouts = Array.isArray(r.parsed_workouts) ? r.parsed_workouts : [];
    workouts.forEach((w, i) => {
      const dow = (w as { dayOfWeek?: unknown })?.dayOfWeek;
      if (dow === undefined || dow === null) return;
      if (typeof dow !== 'number' || !Number.isInteger(dow) || dow < 0 || dow > 6) at(`workout #${i} dayOfWeek ${JSON.stringify(dow)}`);
    });
  }
  return out;
}

/** Activities whose own fields contradict each other. */
export function impossibleActivities(rows: ActivityRow[], now: Date = new Date()): Finding[] {
  const out: Finding[] = [];
  const future = now.getTime() + 2 * 86_400_000; // start_time is wall-clock-shaped; allow a day of skew
  for (const r of rows) {
    const at = (detail: string) => out.push({ check: 'impossible-activity', table: 'athlete_activities', id: r.id, detail });
    if (!r.start_time || Number.isNaN(Date.parse(r.start_time))) { at('start_time missing or unparsable'); continue; }
    if (Date.parse(r.start_time) > future) at(`start_time ${r.start_time} is in the future`);
    if (r.distance != null && r.distance < 0) at(`distance ${r.distance} < 0`);
    if (r.duration != null && r.duration < 0) at(`duration ${r.duration} < 0`);
    if (r.distance && r.duration && r.distance / r.duration > IMPOSSIBLE_SPEED) at(`speed ${(r.distance / r.duration).toFixed(1)} m/s is faster than a human runs`);
  }
  return out;
}

/** Above this average speed a "run" is suspicious (likely a ride logged as a run); m/s. */
export const SUSPICIOUS_SPEED = 7;
/** Above this it is not suspicious but broken — impossibleActivities already reports it; m/s. */
export const IMPOSSIBLE_SPEED = 12;

export interface SuspiciousSpeed {
  id: string;
  athlete_id: string | null;
  date: string | null;
  distance: number;
  speed: number;
}

/**
 * Runs with an average speed in (7, 12] m/s — faster than any club runner, slower
 * than "broken". Almost always a ride logged as a run, which distorts PRs. A
 * separate list, not a Finding: it is a lead to check by hand, not a broken row.
 * Ids only, no names.
 */
export function suspiciousSpeed(rows: ActivityRow[]): SuspiciousSpeed[] {
  const out: SuspiciousSpeed[] = [];
  for (const r of rows) {
    if (!r.distance || !r.duration || r.distance <= 0 || r.duration <= 0) continue;
    const speed = r.distance / r.duration;
    if (speed > SUSPICIOUS_SPEED && speed <= IMPOSSIBLE_SPEED) {
      out.push({ id: r.id, athlete_id: r.athlete_id, date: r.start_time ? r.start_time.slice(0, 10) : null, distance: r.distance, speed: Math.round(speed * 100) / 100 });
    }
  }
  return out;
}

export function summarize(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) {
    const k = `${f.check}:${f.table}`;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
