import { beforeEach, describe, expect, it, vi } from 'vitest';

/** daySessionWorkoutsByWeek, the REAL helper over a fake PostgREST: mapping, paging past 1000 rows, and failing honestly. */
const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false, ranges: [] as Array<[number, number]>, orders: [] as string[] }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => {
      const c: any = {};
      for (const m of ['select', 'gte', 'lte', 'not']) c[m] = () => c;
      c.order = (col: string) => { h.orders.push(col); return c; };
      c.range = async (from: number, to: number) => {
        h.ranges.push([from, to]);
        return h.fail ? { data: null, error: { message: 'boom' } } : { data: h.rows.slice(from, to + 1), error: null };
      };
      return c;
    },
  }),
}));
const { daySessionWorkoutsByWeek } = await import('@/lib/day-session/week-merge');

const row = (date: string, i = 0) => ({ id: `s${date}-${i}`, session_date: date, title: `Session ${date}`, published_at: '2026-11-01T00:00:00Z',
  start_time: '06:30:00', place: 'Park', quality: true, nutrition: [], description: 'desc',
  steps: [{ order: 1, type: 'active', durationType: 'distance', durationValue: 9000, targetType: 'no_target' }] });

beforeEach(() => { h.rows = []; h.fail = false; h.ranges = []; h.orders = []; });

describe('daySessionWorkoutsByWeek', () => {
  it('maps each session exactly like the per-week helper and keys it by its plan week (Sunday)', async () => {
    h.rows = [row('2026-11-21'), row('2026-11-15'), row('2026-11-08')]; // Sat, Sun, Sun
    const r = await daySessionWorkoutsByWeek('2026-11-08', '2026-11-15');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.byWeek.keys()].sort()).toEqual(['2026-11-08', '2026-11-15']);
    const sat = r.byWeek.get('2026-11-15')!.find((w) => w.workoutKey === 'day:2026-11-21')!;
    expect(sat).toMatchObject({ dayOfWeek: 6, name: 'Session 2026-11-21',
      daySession: { date: '2026-11-21', quality: true, startTime: '06:30', place: 'Park', hasNutrition: false, notes: 'desc' } });
    expect(sat.steps).toHaveLength(1);
  });
  it('pages past one PostgREST page (1000 rows) with a stable order, so a long span is not truncated', async () => {
    h.rows = Array.from({ length: 1500 }, (_, i) => row('2026-11-09', i));
    const r = await daySessionWorkoutsByWeek('2026-11-08', '2026-11-08');
    expect(r.ok && r.byWeek.get('2026-11-08')!.length).toBe(1500);
    expect(h.ranges[0]).toEqual([0, 999]);
    expect(h.ranges.length).toBeGreaterThan(1);
    expect(h.orders).toEqual(expect.arrayContaining(['session_date', 'id']));
  });
  it('a read error is { ok: false }, never an empty map', async () => {
    h.fail = true;
    expect(await daySessionWorkoutsByWeek('2026-11-08', '2026-11-15')).toEqual({ ok: false });
  });
  it('an empty or reversed span asks nothing and answers ok with no weeks', async () => {
    expect(await daySessionWorkoutsByWeek('2026-11-15', '2026-11-08')).toMatchObject({ ok: true });
    expect(h.ranges).toHaveLength(0);
  });
});
