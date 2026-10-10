import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from './helpers/memory-db';
import { doubleDayParts, intervals, nestedRepeat } from './fixtures/watch-workouts';

const garminPush = vi.hoisted(() => vi.fn(async (a: { athlete: { id: string; name: string } }) => ({ athleteId: a.athlete.id, athleteName: a.athlete.name, status: 'success' as const })));
vi.mock('@/lib/garmin/push-week', () => ({ pushWeekToAthlete: garminPush }));

import { appleCandidates, deliverWeek, resolveWatchProvider } from '@/lib/watch';
import { enqueueAppleWeek, workoutDate } from '@/lib/watch/providers/apple';
import { resetWatchSchemaCache } from '@/lib/watch/schema';
import { garminProvider } from '@/lib/watch/providers/garmin';

const DELIVERY_COLS = ['id', 'plan_id', 'athlete_id', 'workout_date', 'workout_data', 'garmin_workout_id', 'status', 'error_message', 'created_at', 'workout_key', 'device_confirmed_at'];
const SCHEMA = {
  athletes: ['id', 'max_hr_bpm'],
  athlete_devices: ['id', 'athlete_id', 'revoked_at', 'scheduler_authorized'],
  workout_deliveries: [...DELIVERY_COLS, 'provider', 'provider_plan_id', 'superseded_at', 'removed_at'],
};
const PRE = { athletes: ['id', 'max_hr_bpm'], workout_deliveries: DELIVERY_COLS };

const athlete = { id: 'ath-1', name: 'R', garmin_auth: null, groups: { pace_profile: { marathonGoal: 'SUB 2:30', offsetSeconds: 0 } } };

function db(schema: Record<string, string[]> = SCHEMA) {
  const d = createMemoryDb({ schema, defaults: { workout_deliveries: () => ({ provider: 'garmin' }) } });
  d.tables.athletes.push({ id: 'ath-1', max_hr_bpm: 185 });
  return d;
}
const input = (d: ReturnType<typeof db>, workouts = [intervals], over: Record<string, unknown> = {}) => ({
  supabase: d.client, athlete, plannedWorkouts: workouts, weekStartDate: '2026-10-04', planId: 'p-1', paceTarget: false, ...over,
});

beforeEach(() => {
  resetWatchSchemaCache();
  garminPush.mockClear();
});

describe('resolveWatchProvider', () => {
  it('a Garmin link always wins, even with an Apple device registered', () => {
    expect(resolveWatchProvider({ id: 'a', name: '', garmin_auth: { t: 1 } }, new Set(['a']))).toBe('garmin');
  });
  it('no Garmin link + an authorized Apple device → apple; otherwise the old Garmin path', () => {
    expect(resolveWatchProvider({ id: 'a', name: '', garmin_auth: null }, new Set(['a']))).toBe('apple');
    expect(resolveWatchProvider({ id: 'a', name: '', garmin_auth: null }, new Set())).toBe('garmin');
    expect(resolveWatchProvider({ id: 'a', name: '' })).toBe('garmin');
  });
});

describe('appleCandidates', () => {
  it('never queries for an athlete with a Garmin link', async () => {
    const d = db();
    await appleCandidates(d.client, [{ id: 'g', name: '', garmin_auth: { t: 1 } }]);
    expect(d.log).toEqual([]);
  });
  it('finds live, scheduler-authorized devices only', async () => {
    const d = db();
    d.tables.athlete_devices.push(
      { id: '1', athlete_id: 'a', revoked_at: null, scheduler_authorized: true },
      { id: '2', athlete_id: 'b', revoked_at: '2026-01-01', scheduler_authorized: true },
      { id: '3', athlete_id: 'c', revoked_at: null, scheduler_authorized: false },
    );
    const ids = await appleCandidates(d.client, ['a', 'b', 'c', 'd'].map((id) => ({ id, name: '', garmin_auth: null })));
    expect([...ids]).toEqual(['a']);
  });
  it('is empty before 136, and on a client that throws', async () => {
    expect((await appleCandidates(db(PRE).client, [{ id: 'a', name: '' }])).size).toBe(0);
    resetWatchSchemaCache();
    const broken = { from: () => { throw new Error('boom'); } } as any;
    expect((await appleCandidates(broken, [{ id: 'a', name: '' }])).size).toBe(0);
  });
});

describe('the Garmin adapter is pushWeekToAthlete, argument for argument', () => {
  it('passes everything through and tags the provider', async () => {
    const d = db();
    const args = { ...input(d), notify: false, cleanDayOnce: true };
    const result = await garminProvider.deliverWeek(args);
    expect(garminPush).toHaveBeenCalledWith({
      supabase: d.client, athlete, plannedWorkouts: [intervals], weekStartDate: '2026-10-04', planId: 'p-1', paceTarget: false, notify: false, cleanDayOnce: true,
    });
    expect(result).toEqual({ athleteId: 'ath-1', athleteName: 'R', status: 'success', provider: 'garmin' });
  });
});

describe('Apple delivery queues rows for the phone', () => {
  it('writes one pending row per part, on the same date Garmin would use', async () => {
    const d = db();
    const res = await deliverWeek('apple', input(d, doubleDayParts));
    expect(res).toMatchObject({ status: 'success', queued: true, provider: 'apple' });
    const rows = d.tables.workout_deliveries;
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r: any) => r.workout_date))).toEqual(new Set([workoutDate('2026-10-04', 1)]));
    expect(workoutDate('2026-10-04', 1)).toBe('2026-10-05');
    for (const r of rows) {
      expect(r).toMatchObject({ provider: 'apple', status: 'pending', plan_id: 'p-1', athlete_id: 'ath-1' });
      expect(r.provider_plan_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.workout_data.schema).toBe('madregot.watch-workout');
      expect(r.garmin_workout_id ?? null).toBeNull();
    }
    expect(garminPush).not.toHaveBeenCalled();
  });

  it('resolves HR with the athlete\'s max HR when the row did not carry it', async () => {
    const d = db();
    const hr = { dayOfWeek: 0, name: 'hr', workoutKey: 'k', steps: [{ order: 1, type: 'active' as const, durationType: 'time' as const, durationValue: 600, targetType: 'heart_rate' as const, targetHrMinPct: 80, targetHrMaxPct: 80 }] };
    await enqueueAppleWeek(input(d, [hr], { paceTarget: true }));
    expect(d.tables.workout_deliveries[0].workout_data.blocks[0].steps[0].alert).toEqual({ type: 'heartRateRange', minBpm: 148, maxBpm: 148 });
  });

  it('re-pushing the same week is a no-op: same rows, same plan ids', async () => {
    const d = db();
    await enqueueAppleWeek(input(d, [intervals, nestedRepeat]));
    const before = d.tables.workout_deliveries.map((r: any) => r.provider_plan_id);
    const again = await enqueueAppleWeek(input(d, [intervals, nestedRepeat]));
    expect(again).toEqual({ inserted: 0, kept: 2, superseded: 0 });
    expect(d.tables.workout_deliveries.map((r: any) => r.provider_plan_id)).toEqual(before);
  });

  it('an edited workout supersedes its row and gets a new plan id; a removed part is superseded too', async () => {
    const d = db();
    await enqueueAppleWeek(input(d, doubleDayParts));
    const edited = JSON.parse(JSON.stringify(doubleDayParts[1]));
    edited.steps[0].durationValue = 3000;
    const res = await enqueueAppleWeek(input(d, [doubleDayParts[0], edited]));
    expect(res).toEqual({ inserted: 1, kept: 1, superseded: 3 });
    const live = d.tables.workout_deliveries.filter((r: any) => !r.superseded_at);
    expect(live.map((r: any) => r.workout_key).sort()).toEqual(['d1-p1-warmup', 'd1-p2-test']);
  });

  it('an alert-mode change is new content (the watch would behave differently)', async () => {
    const d = db();
    await enqueueAppleWeek(input(d));
    const res = await enqueueAppleWeek(input(d, [intervals], { paceTarget: true }));
    expect(res).toEqual({ inserted: 1, kept: 0, superseded: 1 });
  });

  it('before 136 it fails honestly instead of writing a half-row', async () => {
    const d = db(PRE);
    const res = await deliverWeek('apple', input(d));
    expect(res).toMatchObject({ status: 'failed', provider: 'apple', error: 'Apple Watch delivery is not enabled yet' });
    expect(d.tables.workout_deliveries).toHaveLength(0);
  });
});
