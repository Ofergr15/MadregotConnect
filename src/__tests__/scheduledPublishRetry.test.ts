import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushed: string[] = [];
vi.mock('@/lib/garmin/push-week', () => ({ pushWeekToAthlete: vi.fn(async (o: any) => { pushed.push(o.athlete.id); return { status: 'success' }; }) }));
vi.mock('@/lib/academy/settings-server', () => ({ loadAcademySettings: vi.fn(async () => ({ paceAlerts: false })) }));
vi.mock('@/lib/push', () => ({ notifyAthlete: vi.fn(async () => ({})) }));
vi.mock('@/lib/notifications/routing', () => ({ recipientsForKind: vi.fn(async () => null) }));
vi.mock('@/lib/plans/cache', () => ({ revalidateWeeklyPlans: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/ai/parser', () => ({ parseWorkoutPlan: vi.fn(), EmptyParseError: class extends Error {} }));

import { runScheduledPlanPublishes } from '@/lib/plan-builder/server';

const body = { weekStartDate: '2026-11-22', workouts: [] } as any;
const version = { id: 'v1', week_start: '2026-11-22', plan_id: 'p1', version: 2, body, state: 'scheduled', publish_at: '2026-11-21T00:00:00Z', publish_opts: { notify: false, push: true, overwriteWatch: false }, published_at: null };
const athlete = { id: 'a1', name: 'A', garmin_auth: 'x', is_academy: false, group_id: 'g', groups: { name: 'קבוצה 1' } };

/** Chainable fake Supabase: every builder method returns the builder; awaiting resolves via `answer`. */
function fakeDb(answer: (table: string, ops: string[]) => any) {
  const writes: { table: string; op: string; arg: any }[] = [];
  const from = (table: string) => {
    const ops: string[] = [];
    const b: any = new Proxy({}, {
      get(_t, k: string) {
        if (k === 'then') return (res: any, rej: any) => Promise.resolve({ data: answer(table, ops), error: null }).then(res, rej);
        return (arg?: any) => {
          ops.push(`${k}:${typeof arg === 'string' ? arg : ''}`);
          if (['upsert', 'update', 'insert'].includes(k)) writes.push({ table, op: k, arg });
          return b;
        };
      },
    });
    return b;
  };
  return { db: { from } as any, writes };
}

const has = (ops: string[], s: string) => ops.some((o) => o.startsWith(s));

beforeEach(() => { pushed.length = 0; });

describe('runScheduledPlanPublishes', () => {
  it('runs an expired Garmin backoff retry on a tick with zero due publications', async () => {
    const { db, writes } = fakeDb((t, ops) => {
      if (t === 'weekly_plan_versions' && has(ops, 'single')) return version;
      if (t === 'weekly_plan_versions') return [];
      if (t === 'plan_push_status' && ops.includes('eq:state')) return [{ version_id: 'v1', athlete_id: 'a1' }];
      if (t === 'plan_push_status' && has(ops, 'maybeSingle')) return { attempts: 1 };
      if (t === 'athletes') return [athlete];
      return [];
    });
    const fired = await runScheduledPlanPublishes(db, new Date('2026-11-22T10:00:00Z'));
    expect(pushed).toEqual(['a1']);
    expect(fired).toEqual(['planPushRetry 1']);
    expect(writes.find((w) => w.table === 'plan_push_status' && w.op === 'upsert')?.arg).toMatchObject({ state: 'sent', attempts: 2 });
  });

  it('still publishes a due scheduled version as before', async () => {
    const { db, writes } = fakeDb((t, ops) => {
      if (t === 'weekly_plan_versions' && ops.includes('eq:state')) return [version];
      if (t === 'weekly_plan_versions') return [];
      if (t === 'weekly_plans' && has(ops, 'single')) return { id: 'p1' };
      if (t === 'weekly_plans' && has(ops, 'maybeSingle')) return null;
      if (t === 'plan_push_status' && ops.includes('eq:state')) return [];
      if (t === 'plan_push_status' && has(ops, 'maybeSingle')) return null;
      if (t === 'athletes') return [athlete];
      return [];
    });
    const fired = await runScheduledPlanPublishes(db, new Date('2026-11-22T10:00:00Z'));
    expect(fired).toEqual(['planPublish 2026-11-22 v2']);
    expect(writes.some((w) => w.table === 'weekly_plan_versions' && w.op === 'update' && w.arg.state === 'published')).toBe(true);
    expect(pushed).toEqual(['a1']);
  });
});
