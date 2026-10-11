import { beforeEach, describe, expect, it, vi } from 'vitest';

const garmin = vi.hoisted(() => ({ account: new Set<string>(), next: 100, failCreate: false }));
vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class {
    async createWorkout() { if (garmin.failCreate) throw new Error('rate limited'); const id = String(garmin.next++); garmin.account.add(id); return id; }
    async scheduleWorkout() {}
    async deleteWorkout(id: string) { garmin.account.delete(id); }
    async verifyWorkoutOnAccount(id: string) { if (!garmin.account.has(id)) throw new Error('not on account'); }
  },
}));
vi.mock('@/lib/garmin/converter', () => ({ convertToGarminWorkout: () => ({}) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), israelToday: () => '2026-10-11' }));

import { pushWeekToAthlete } from '@/lib/garmin/push-week';

type Row = Record<string, unknown> & { id: string };
function fakeDb(rows: Row[]) {
  let n = 0;
  const from = () => {
    const f: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Record<string, unknown> = {};
    const run = () => {
      const hit = rows.filter((r) => f.every((x) => x(r)));
      if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
      if (op === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { data: hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { f.push((r) => r[k] !== v); return q; },
      not: (k: string) => { f.push((r) => r[k] != null); return q; },
      gte: (k: string, v: string) => { f.push((r) => String(r[k]) >= v); return q; },
      in: (k: string, vs: unknown[]) => { f.push((r) => vs.includes(r[k])); return q; },
      update: (u: Record<string, unknown>) => { op = 'update'; patch = u; return q; },
      delete: () => { op = 'delete'; return q; },
      insert: (r: Record<string, unknown>) => {
        const row = { ...r, id: `row-${++n}` } as Row; rows.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: row.id }, error: null }) }), then: (ok: (v: unknown) => unknown) => ok({ error: null }) };
      },
      then: (ok: (v: unknown) => unknown) => ok(run()),
    };
    return q;
  };
  return { from } as never;
}

const send = (rows: Row[], plannedWorkouts: unknown[], removedKeys: string[] = []) => pushWeekToAthlete({
  supabase: fakeDb(rows), athlete: { id: 'a1', name: 'A', garmin_auth: {} },
  plannedWorkouts: plannedWorkouts as never[], weekStartDate: '2026-10-11', planId: 'p1',
  paceTarget: false, notify: false, cleanDayOnce: true, removedKeys,
});

describe('custom week: a session skipped for one athlete', () => {
  beforeEach(() => { garmin.account = new Set(['w-mon', 'w-wed']); garmin.next = 100; garmin.failCreate = false; });

  it('comes off their watch, and off their card', async () => {
    const rows: Row[] = [
      { id: 'r-mon', plan_id: 'p1', athlete_id: 'a1', workout_date: '2026-10-12', workout_key: 'day-1-part-1-single', garmin_workout_id: 'w-mon', status: 'success' },
      { id: 'r-wed', plan_id: 'p1', athlete_id: 'a1', workout_date: '2026-10-14', workout_key: 'day-3-part-1-single', garmin_workout_id: 'w-wed', status: 'success' },
    ];
    await send(rows, [{ dayOfWeek: 1, workoutKey: 'day-1-part-1-single' }], ['day-3-part-1-single']);
    expect(garmin.account.has('w-wed')).toBe(false);
    expect(rows.find((r) => r.id === 'r-wed')).toBeUndefined();
  });
});

describe('a re-push that fails after removing the old copy', () => {
  beforeEach(() => { garmin.account = new Set(['w-sun']); garmin.next = 100; garmin.failCreate = true; });

  it("stops the old row from saying 'on the watch'", async () => {
    const rows: Row[] = [{ id: 'r-sun', plan_id: 'p1', athlete_id: 'a1', workout_date: '2026-10-11', workout_key: 'day-0-part-1-single', garmin_workout_id: 'w-sun', status: 'success' }];
    const res = await send(rows, [{ dayOfWeek: 0, workoutKey: 'day-0-part-1-single' }]);
    expect(res.status).toBe('failed');
    expect(garmin.account.has('w-sun')).toBe(false);
    expect(rows.find((r) => r.id === 'r-sun')?.status).toBe('failed');
  });
});
