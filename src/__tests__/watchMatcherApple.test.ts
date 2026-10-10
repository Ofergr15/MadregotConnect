import { describe, expect, it } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { findComputedActivityMatch, matchAthleteActivities } from '@/lib/plans/match-athlete-activities';
import { normalizeParsedWorkouts } from '@/lib/plans/normalize-plan';
import { pairByProviderPlanId } from '@/lib/watch/plan-matches';

const ATHLETE = 'a-1';
const PLAN = 'p-1';
const PLAN_UUID = '7a1d2f3e-0000-4000-8000-000000000001';

const SCHEMA = {
  athletes: ['id', 'group_id'],
  groups: ['id', 'name'],
  weekly_plans: ['id', 'week_start_date', 'athlete_id', 'parsed_workouts', 'created_at', 'status'],
  athlete_activities: ['id', 'athlete_id', 'start_time', 'distance', 'activity_name', 'garmin_workout_id', 'provider_plan_id', 'created_at'],
  workout_deliveries: ['id', 'plan_id', 'athlete_id', 'garmin_workout_id', 'workout_key', 'device_confirmed_at', 'provider', 'provider_plan_id', 'created_at'],
  activity_plan_matches: ['id', 'activity_id', 'athlete_id', 'weekly_plan_id', 'workout_key', 'group_number', 'match_method', 'score', 'evidence', 'created_at'],
};

const step = (m: number) => ({ order: 1, type: 'active', durationType: 'distance', durationValue: m, targetType: 'no_target' });
const week = () => ({ workouts: [10, 8, 12].map((k, day) => ({ dayOfWeek: day, name: `d${day}`, expectedDistanceM: k * 1000, steps: [step(k * 1000)] })) });

function seed() {
  const db = createMemoryDb({ schema: SCHEMA });
  const t = db.tables;
  t.athletes.push({ id: ATHLETE, group_id: null });
  const parsed = normalizeParsedWorkouts(week()) as any;
  t.weekly_plans.push({ id: PLAN, week_start_date: '2026-09-27', athlete_id: null, parsed_workouts: parsed, created_at: '2026-09-26T00:00:00Z', status: 'pushed' });
  const keys = parsed.workouts.map((w: any) => w.workoutKey);
  // Apple delivery for day 2's slot.
  t.workout_deliveries.push({ id: 'del-apple', plan_id: PLAN, athlete_id: ATHLETE, garmin_workout_id: null, workout_key: keys[2], provider: 'apple', provider_plan_id: PLAN_UUID });
  return { db, keys };
}

describe('Apple plan-id attribution', () => {
  it('pairs the run HealthKit stamped with our plan id, even when the distance would not', async () => {
    const { db, keys } = seed();
    // Day 1, 5 km: the heuristic would never call this the 12 km on day 2 — but the watch says it was.
    db.tables.athlete_activities.push({ id: 'run', athlete_id: ATHLETE, start_time: '2026-09-28T06:00:00Z', distance: 5000, activity_name: 'Run', garmin_workout_id: null, provider_plan_id: PLAN_UUID });
    await matchAthleteActivities(db.client, ATHLETE);
    const rows = db.tables.activity_plan_matches;
    expect(rows).toEqual([expect.objectContaining({
      activity_id: 'run', workout_key: keys[2], match_method: 'apple_workout', score: 100,
      evidence: { reason: 'provider_plan_id', providerPlanId: PLAN_UUID, deliveryId: 'del-apple' },
    })]);
    expect(db.tables.workout_deliveries[0].device_confirmed_at).toBeTruthy();

    const computed = await findComputedActivityMatch(db.client, 'run', ATHLETE);
    expect(computed).toMatchObject({ workoutKey: keys[2], matchMethod: 'apple_workout', score: 100 });
  });

  it('survives a re-match (a later Strava/Garmin sync recomputes and keeps it)', async () => {
    const { db } = seed();
    db.tables.athlete_activities.push({ id: 'run', athlete_id: ATHLETE, start_time: '2026-09-29T06:00:00Z', distance: 12000, activity_name: 'Run', provider_plan_id: PLAN_UUID });
    await matchAthleteActivities(db.client, ATHLETE);
    await matchAthleteActivities(db.client, ATHLETE);
    expect(db.tables.activity_plan_matches.map((r: any) => r.match_method)).toEqual(['apple_workout']);
  });

  it('a coach\'s manual match still outranks it', async () => {
    const { db, keys } = seed();
    db.tables.athlete_activities.push({ id: 'run', athlete_id: ATHLETE, start_time: '2026-09-29T06:00:00Z', distance: 12000, activity_name: 'Run', provider_plan_id: PLAN_UUID });
    db.tables.activity_plan_matches.push({ id: 'm', activity_id: 'run', athlete_id: ATHLETE, weekly_plan_id: PLAN, workout_key: keys[0], group_number: 2, match_method: 'manual' });
    await matchAthleteActivities(db.client, ATHLETE);
    expect(db.tables.activity_plan_matches.map((r: any) => [r.activity_id, r.match_method])).toEqual([['run', 'manual']]);
  });

  it('pairByProviderPlanId: one slot per run, first run wins, unknown ids ignored, case-insensitive', () => {
    const deliveries = [{ id: 'd', provider_plan_id: PLAN_UUID.toUpperCase(), workout_key: 'k' }, { id: 'e', provider_plan_id: null, workout_key: 'x' }];
    expect(pairByProviderPlanId(
      [{ id: 'a', provider_plan_id: PLAN_UUID }, { id: 'b', provider_plan_id: PLAN_UUID }, { id: 'c', provider_plan_id: 'other' }],
      deliveries,
    )).toEqual([{ activityId: 'a', workoutKey: 'k', deliveryId: 'd', providerPlanId: PLAN_UUID }]);
  });
});

describe('the other importers defer to an Apple row', () => {
  it('a Garmin sync that finds an Apple twin skips (twinVerdict only upgrades Strava)', async () => {
    const { twinVerdict } = await import('@/lib/activity-dedup');
    expect(twinVerdict({ id: 'x', source: 'apple', start_time: '2026-10-08T06:30:00Z', distance: 10000 })).toBe('skip');
    expect(twinVerdict({ id: 'x', source: 'strava', start_time: '2026-10-08T06:30:00Z', distance: 10000 })).toBe('upgrade');
  });
});
