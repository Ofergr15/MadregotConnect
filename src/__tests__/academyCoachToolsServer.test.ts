import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';

// The pace update reaching the plan: reresolveFuturePlans against a fake table store.

vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: () => {} }));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: async () => ({ paceAlerts: true }) }));
const pushes: Array<{ days: number[]; planId: string | null }> = [];
vi.mock('@/lib/garmin/push-week', () => ({
  pushWeekToAthlete: async (args: { athlete: { id: string }; plannedWorkouts: ParsedWorkout[]; planId: string | null }) => {
    pushes.push({ days: args.plannedWorkouts.map(w => w.dayOfWeek), planId: args.planId });
    return { athleteId: args.athlete.id, athleteName: '', status: 'success' };
  },
}));

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};

/** A tiny PostgREST-shaped builder over `db`: enough for the reads and writes under test. */
function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let insert: Row | null = null;
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let single = false;
  const run = () => {
    const rows = db[table] ?? (db[table] = []);
    if (insert) {
      const row = { id: `id-${rows.length + 1}`, created_at: new Date().toISOString(), ...insert };
      rows.push(row);
      return { data: single ? row : [row], error: null };
    }
    let out = rows.filter(r => filters.every(f => f(r)));
    if (patch) { out.forEach(r => Object.assign(r, patch)); }
    if (order) out = [...out].sort((a, b) => (a[order!.col] < b[order!.col] ? -1 : 1) * (order!.asc ? 1 : -1));
    if (limit !== null) out = out.slice(0, limit);
    return { data: single ? out[0] ?? null : out, error: null };
  };
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { filters.push(r => r[c] !== v); return b; },
    not: (c: string) => { filters.push(r => r[c] != null); return b; },
    in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return b; },
    gte: (c: string, v: string) => { filters.push(r => r[c] >= v); return b; },
    lte: (c: string, v: string) => { filters.push(r => r[c] <= v); return b; },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { limit = n; return b; },
    update: (p: Row) => { patch = p; return b; },
    insert: (p: Row) => { insert = p; return b; },
    single: () => { single = true; return Promise.resolve(run()); },
    maybeSingle: () => { single = true; return Promise.resolve(run()); },
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
  };
  return b;
}
const supabase = { from } as any;

const T = 268;
const step = (over: Partial<WorkoutStep>): WorkoutStep => ({ order: 1, type: 'active', durationType: 'distance', durationValue: 1000, targetType: 'pace', ...over } as WorkoutStep);
const reps = (sec: number): WorkoutStep => ({
  order: 2, type: 'interval', durationType: 'distance', targetType: 'no_target', repeatCount: 6,
  repeatSteps: [step({ type: 'interval', durationValue: 800, targetPaceMinPerKm: sec - 2, targetPaceMaxPerKm: sec + 2 })],
});
const week = (sec: number): ParsedWorkout[] => [
  { dayOfWeek: 0, name: 'a', steps: [step({ type: 'warmup', durationValue: 2000, targetPaceMinPerKm: 330, targetPaceMaxPerKm: 330 }), reps(sec)] },
  { dayOfWeek: 6, name: 'b', steps: [step({ durationValue: 16000, targetPaceMinPerKm: 325, targetPaceMaxPerKm: 335 })] },
];

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  pushes.length = 0;
  db.athletes = [{ id: 'a1', name: 'A', garmin_auth: { t: 1 }, is_academy: true, groups: null }];
  db.weekly_plans = [
    // This week: not touched (the update applies from next week).
    { id: 'p0', coach_id: 'COACH', athlete_id: 'a1', week_start_date: '2026-10-04', parsed_workouts: { workouts: week(245) }, created_at: '2026-10-01' },
    // Next week, pushed: the reps move by −7, the long run stays; on-watch days go again.
    { id: 'p1', coach_id: 'COACH', athlete_id: 'a1', week_start_date: '2026-10-11', parsed_workouts: { workouts: week(245) }, created_at: '2026-10-02' },
    // The week after, a draft: re-resolved, not sent.
    { id: 'p2', coach_id: 'COACH', athlete_id: 'a1', week_start_date: '2026-10-18', parsed_workouts: { workouts: week(245) }, created_at: '2026-10-03' },
  ];
  db.workout_deliveries = [
    { plan_id: 'p1', athlete_id: 'a1', workout_date: '2026-10-11', status: 'success' },
    { plan_id: 'p1', athlete_id: 'a1', workout_date: '2026-10-17', status: 'success' },
  ];
});

vi.mock('@/lib/constants', async (orig) => ({ ...(await orig() as object), COACH_ID: 'COACH' }));

describe('reresolveFuturePlans', () => {
  it('moves the planned reps from next week on, leaves this week and easy alone, re-sends what was on the watch', async () => {
    const { reresolveFuturePlans } = await import('@/lib/academy/coach-tools-server');
    const r = await reresolveFuturePlans(supabase, { athleteId: 'a1', fromWeek: '2026-10-11', thresholdSec: T, target: { reps: -7 }, today: '2026-10-10' });
    expect(r.weeks).toEqual(['2026-10-11', '2026-10-18']);
    const repOf = (id: string) => db.weekly_plans.find(p => p.id === id)!.parsed_workouts.workouts[0].steps[1].repeatSteps[0];
    expect(repOf('p0').targetPaceMinPerKm).toBe(243);
    expect(repOf('p1').targetPaceMinPerKm).toBe(236);
    expect(repOf('p2').targetPaceMinPerKm).toBe(236);
    const long = db.weekly_plans.find(p => p.id === 'p1')!.parsed_workouts.workouts[1].steps[0];
    expect(long.targetPaceMinPerKm).toBe(325);
    // Only the changed session that is on the watch goes again (Sunday), not the long run.
    expect(pushes).toEqual([{ days: [0], planId: 'p1' }]);
  });

  it('is idempotent: the same update twice moves nothing the second time', async () => {
    const { reresolveFuturePlans } = await import('@/lib/academy/coach-tools-server');
    await reresolveFuturePlans(supabase, { athleteId: 'a1', fromWeek: '2026-10-11', thresholdSec: T, target: { reps: -7 }, today: '2026-10-10' });
    const again = await reresolveFuturePlans(supabase, { athleteId: 'a1', fromWeek: '2026-10-11', thresholdSec: T, target: { reps: -7 }, today: '2026-10-10' });
    expect(again.weeks).toEqual([]);
    const rep = db.weekly_plans.find(p => p.id === 'p1')!.parsed_workouts.workouts[0].steps[1].repeatSteps[0];
    expect(rep.targetPaceMinPerKm).toBe(236);
  });
});
