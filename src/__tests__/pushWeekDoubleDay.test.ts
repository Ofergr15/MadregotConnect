import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A TWO-A-DAY MUST REACH THE WATCH AS TWO WORKOUTS (feedback c2fc7174).
 *
 * Before each session the push deletes what Garmin already holds for that plan and
 * day, so a re-push replaces instead of duplicating. Run per session, that cleanup
 * found the morning run this same push had just created, and deleted it: only the
 * evening reached the watch, and both rows said success. These tests drive the
 * real delivery against a fake Garmin account and a fake deliveries table.
 */

const garmin = vi.hoisted(() => ({ account: new Set<string>(), next: 1, deleted: [] as string[] }));

vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class {
    async createWorkout() { const id = String(garmin.next++); garmin.account.add(id); return id; }
    async scheduleWorkout() {}
    async deleteWorkout(id: string) { garmin.deleted.push(id); garmin.account.delete(id); }
    async verifyWorkoutOnAccount(id: string) { if (!garmin.account.has(id)) throw new Error('not on account'); }
  },
}));
vi.mock('@/lib/garmin/converter', () => ({ convertToGarminWorkout: () => ({}) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn() }));

import { pushWeekToAthlete } from '@/lib/garmin/push-week';

type Row = Record<string, unknown> & { id: string };

/** Just enough of supabase-js for push-week: select with eq/not/neq filters, insert, update. */
function fakeDb(rows: Row[]) {
  let n = 0;
  const from = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingUpdate: Record<string, unknown> | null = null;
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      not: (k: string) => { filters.push(r => r[k] != null); return q; },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      in: (k: string, vs: unknown[]) => {
        for (const r of rows) if (vs.includes(r[k]) && pendingUpdate) Object.assign(r, pendingUpdate);
        return Promise.resolve({ error: null });
      },
      update: (u: Record<string, unknown>) => { pendingUpdate = u; return q; },
      insert: (r: Record<string, unknown>) => {
        const row = { ...r, id: `row-${++n}` } as Row;
        rows.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: row.id }, error: null }) }) };
      },
      then: (ok: (v: { data: Row[] }) => unknown) => ok({ data: rows.filter(r => filters.every(f => f(r))) }),
    };
    return q;
  };
  return { from } as never;
}

const week = [
  { dayOfWeek: 1, workoutKey: 'day-1-part-1-single' },
  { dayOfWeek: 2, workoutKey: 'day-2-part-1-morning' },
  { dayOfWeek: 2, workoutKey: 'day-2-part-2-evening' },
] as never[];

const push = (rows: Row[], cleanDayOnce: boolean) => pushWeekToAthlete({
  supabase: fakeDb(rows),
  athlete: { id: 'a1', name: 'A', garmin_auth: {} },
  plannedWorkouts: week,
  weekStartDate: '2026-09-27',
  planId: 'p1',
  paceTarget: false,
  notify: false,
  cleanDayOnce,
});

describe('a day with two workouts', () => {
  beforeEach(() => { garmin.account.clear(); garmin.next = 1; garmin.deleted = []; });

  it('keeps both on the watch', async () => {
    const res = await push([], true);
    expect(res.status).toBe('success');
    expect([...garmin.account].sort()).toEqual(['1', '2', '3']);
    expect(garmin.deleted).toEqual([]);
  });

  it('still replaces what an earlier push put there, both sessions of it', async () => {
    const rows: Row[] = [];
    await push(rows, true);
    await push(rows, true);
    expect([...garmin.account].sort()).toEqual(['4', '5', '6']);
    expect(garmin.deleted.sort()).toEqual(['1', '2', '3']);
  });

  it('is how it was for everyone else until rollout: the evening deletes the morning', async () => {
    await push([], false);
    expect(garmin.deleted).toEqual(['2']);
    expect(garmin.account.has('2')).toBe(false);
  });

  it('is on for the super user only, on both ways of sending', async () => {
    const { readFileSync } = await import('fs');
    for (const f of ['src/app/api/garmin/push-workouts/route.ts', 'src/app/api/my-watch/route.ts']) {
      expect(readFileSync(f, 'utf8')).toMatch(/cleanDayOnce: auth\.user\.isSuperUser,/);
    }
  });
});
