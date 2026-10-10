import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';

/**
 * Garmin regression guard for the Apple plan-id pairing added to the matcher.
 *
 * `fixtures/matcher-garmin-golden.json` was written by the matcher as it was
 * BEFORE Phase 0 (git HEAD at the time), on this exact data. A Garmin/Strava
 * athlete — no Apple uploads — must get the same rows, and must not cause a
 * single extra query, with or without migration 138.
 */

const ATHLETE = 'a-1';
const PLAN = 'p-1';

const BASE_SCHEMA = {
  athletes: ['id', 'group_id', 'name'],
  groups: ['id', 'name'],
  weekly_plans: ['id', 'week_start_date', 'athlete_id', 'parsed_workouts', 'created_at', 'status'],
  athlete_activities: ['id', 'athlete_id', 'start_time', 'distance', 'activity_name', 'garmin_workout_id', 'created_at'],
  workout_deliveries: ['id', 'plan_id', 'athlete_id', 'garmin_workout_id', 'workout_key', 'device_confirmed_at', 'created_at'],
  activity_plan_matches: ['id', 'activity_id', 'athlete_id', 'weekly_plan_id', 'workout_key', 'group_number', 'match_method', 'score', 'evidence', 'created_at'],
};
const WITH_138 = {
  ...BASE_SCHEMA,
  athlete_activities: [...BASE_SCHEMA.athlete_activities, 'provider_plan_id', 'apple_workout_uuid', 'source'],
  workout_deliveries: [...BASE_SCHEMA.workout_deliveries, 'provider', 'provider_plan_id', 'superseded_at', 'removed_at'],
};

const step = (meters: number) => ({ order: 1, type: 'active', durationType: 'distance', durationValue: meters, targetType: 'no_target' });
const week = (km: number[]) => ({
  workouts: km.map((k, day) => ({ dayOfWeek: day, name: `day ${day}`, expectedDistanceM: k * 1000, steps: [step(k * 1000)] })),
});

function seed(schema: Record<string, string[]>) {
  const db = createMemoryDb({ schema });
  const t = db.tables;
  t.athletes.push({ id: ATHLETE, group_id: 'g-2', name: 'Runner' });
  t.groups.push({ id: 'g-2', name: 'קבוצה 2' });
  const parsed = normalizeParsedWorkouts({ group1: week([10, 8, 12, 0, 6, 15, 20]), group2: week([10, 8, 12, 0, 6, 15, 20]), group3: week([8, 6, 10, 0, 5, 12, 16]) });
  t.weekly_plans.push({ id: PLAN, week_start_date: '2026-09-27', athlete_id: null, parsed_workouts: parsed, created_at: '2026-09-26T10:00:00Z', status: 'pushed' });
  const keys = (parsed as any).group2.workouts.map((w: any) => w.workoutKey);
  // Two Garmin deliveries, one carried by the run, one not.
  t.workout_deliveries.push({ id: 'd-0', plan_id: PLAN, athlete_id: ATHLETE, garmin_workout_id: '9001', workout_key: keys[0] });
  t.workout_deliveries.push({ id: 'd-2', plan_id: PLAN, athlete_id: ATHLETE, garmin_workout_id: '9003', workout_key: keys[2] });
  const act = (id: string, day: number, meters: number, garmin: string | null = null) => ({
    id, athlete_id: ATHLETE, start_time: new Date(Date.UTC(2026, 8, 27 + day, 6, 30)).toISOString(),
    distance: meters, activity_name: 'Run', garmin_workout_id: garmin,
  });
  t.athlete_activities.push(act('x-0', 0, 10050, '9001'), act('x-1', 1, 7900), act('x-2', 2, 12100), act('x-4', 4, 6000), act('x-5', 5, 15200));
  // A coach's manual call survives.
  t.activity_plan_matches.push({ id: 'm-manual', activity_id: 'x-5', athlete_id: ATHLETE, weekly_plan_id: PLAN, workout_key: keys[6], group_number: 2, match_method: 'manual', score: null, evidence: null });
  return db;
}

const persisted = (db: ReturnType<typeof seed>) =>
  db.tables.activity_plan_matches
    .map(({ id: _id, created_at: _c, ...rest }) => rest)
    .sort((a, b) => (a.activity_id < b.activity_id ? -1 : 1));

describe('the matcher gives a Garmin athlete exactly what it gave before Phase 0', () => {
  let golden: string;
  beforeEach(async () => {
    const db = seed(BASE_SCHEMA);
    await matchAthleteActivities(db.client, ATHLETE);
    golden = JSON.stringify({ rows: persisted(db), confirmed: db.tables.workout_deliveries.map((d) => [d.id, !!d.device_confirmed_at]) }, null, 2);
  });

  it('before migration 138 (rows pinned by the pre-change golden file)', async () => {
    await expect(golden).toMatchFileSnapshot('./fixtures/matcher-garmin-golden.json');
  });

  it('after migration 138, with no Apple uploads: same rows, no Apple deliveries query', async () => {
    const db = seed(WITH_138);
    await matchAthleteActivities(db.client, ATHLETE);
    const after = JSON.stringify({ rows: persisted(db), confirmed: db.tables.workout_deliveries.map((d) => [d.id, !!d.device_confirmed_at]) }, null, 2);
    expect(after).toBe(golden);
    expect(db.log.some((q) => q.table === 'workout_deliveries' && q.filters.includes('provider=eq.apple'))).toBe(false);
  });
});
