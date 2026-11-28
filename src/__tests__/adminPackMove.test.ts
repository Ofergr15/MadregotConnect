// Task 152: move a runner between packs — atomic (migration 326), audited, with an effect summary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMoveBody, summariseMove } from '@/lib/groups/pack-move-api';
import type { WatchEffect } from '@/lib/groups/pack-move';
import { israelToday, planWeekStartOf } from '@/lib/utils';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';
const packs = [{ id: G1, name: 'SUB 2:30' }, { id: G2, name: 'SUB 2:35' }, { id: G3, name: 'SUB 2:45' }];

describe('readMoveBody', () => {
  it('takes a pack id or null, refuses the rest', () => {
    expect(readMoveBody({ athleteId: A, toGroupId: G2 })).toEqual({ athleteId: A, toGroupId: G2, dryRun: false, reason: null });
    expect(readMoveBody({ athleteId: A, toGroupId: null, dryRun: true, reason: ' faster ' })).toEqual({ athleteId: A, toGroupId: null, dryRun: true, reason: 'faster' });
    expect(readMoveBody({ athleteId: A })).toHaveProperty('error');
    expect(readMoveBody({ athleteId: 'x', toGroupId: G2 })).toHaveProperty('error');
    expect(readMoveBody({ athleteId: A, toGroupId: 'g2' })).toHaveProperty('error');
    expect(readMoveBody({ athleteId: A, toGroupId: G2, dryRun: 'yes' })).toHaveProperty('error');
    expect(readMoveBody({ athleteId: A, toGroupId: G2, reason: 'x'.repeat(301) })).toHaveProperty('error');
    expect(readMoveBody(null)).toHaveProperty('error');
  });
});

describe('summariseMove', () => {
  const effect = (o: Partial<WatchEffect>): WatchEffect => ({ weekStart: '2026-11-22', fromKey: 'group3', toKey: 'group2', onWatchDays: [4, 6], resendDays: [], reason: 'same_workouts', ...o });
  it('names both packs, says the watch keeps its workouts, and that the runner is told', () => {
    const s = summariseMove({ packs, fromGroupId: G3, toGroupId: G2, fromDate: '2026-11-25', watch: effect({}), pending: null });
    expect(s.from).toEqual({ id: G3, name: 'SUB 2:45', lane: 3 });
    expect(s.to).toEqual({ id: G2, name: 'SUB 2:35', lane: 2 });
    expect(s.watch).toMatchObject({ paceVariantChanges: true, onWatchDays: [4, 6], resendDays: [], reason: 'same_workouts' });
    expect(s.watch.summaryHe).toContain('לא נשלח מחדש');
    expect(s.notifiesRunner).toBe(true);
  });
  it('lists the re-sent days by name, and the Saturday change it cancels', () => {
    const s = summariseMove({ packs, fromGroupId: G3, toGroupId: G1, fromDate: '2026-11-25', watch: effect({ toKey: 'group1', resendDays: [4], reason: 'resend' }), pending: { groupId: G2, from: '2026-11-28' } });
    expect(s.watch.summaryHe).toContain('יום חמישי');
    expect(s.cancelsPending).toEqual({ groupId: G2, name: 'SUB 2:35', from: '2026-11-28' });
  });
  it('a failed watch read is "unknown", never "nothing changes"; to no pack nobody is told', () => {
    const s = summariseMove({ packs, fromGroupId: G3, toGroupId: null, fromDate: '2026-11-25', watch: null, pending: null });
    expect(s.watch.reason).toBe('unknown');
    expect(s.to).toEqual({ id: null, name: null, lane: null });
    expect(s.notifiesRunner).toBe(false);
  });
});

// ── previewWatchEffect + the route, on fixture tables ─────────────────────────
type R = { data: unknown; error: unknown };
let tables: Record<string, R> = {};
let rpcResult: R = { data: null, error: null };
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const writes: string[] = [];
class Q implements PromiseLike<R> {
  constructor(private t: string) {}
  select() { return this; } eq() { return this; } in() { return this; } is() { return this; } gte() { return this; } lte() { return this; }
  order() { return this; } limit() { return this; } maybeSingle() { return this; }
  update() { writes.push(`update ${this.t}`); return this; } insert() { writes.push(`insert ${this.t}`); return this; }
  then<X = R, Y = never>(ok?: ((v: R) => X | PromiseLike<X>) | null, bad?: ((e: unknown) => Y | PromiseLike<Y>) | null): PromiseLike<X | Y> {
    return Promise.resolve(tables[this.t] ?? { data: [], error: null }).then(ok, bad);
  }
}
const fakeDb = {
  from: (t: string) => new Q(t),
  rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcResult; },
};
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeDb }));
const requireStaffCaller = vi.fn();
vi.mock('@/lib/auth/self-or-staff', () => ({ requireStaffCaller: (r: Request) => requireStaffCaller(r) }));
const afterPackMove = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/groups/pack-move', async (orig) => ({ ...(await orig<typeof import('@/lib/groups/pack-move')>()), afterPackMove: (...a: unknown[]) => afterPackMove(...a) }));
const afterQueue: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { afterQueue.push(fn); } }));

const today = israelToday();
const weekStart = planWeekStartOf(today);
const dow = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${weekStart}T12:00:00Z`)) / 86_400_000);
const step = (reps: number) => [{ type: 'repeat', repeatCount: reps, repeatSteps: [{ type: 'active', durationType: 'time', durationValue: 240, targetType: 'pace', targetPaceMinPerKm: 250, targetPaceMaxPerKm: 250 }] }];
const workout = (reps: number) => ({ dayOfWeek: dow, workoutKey: `day-${dow}-0`, name: 'x', steps: step(reps) });
const coach = { denied: null, caller: { athleteId: 'coach-1', email: 'c@x', role: 'coach', isStaff: true, isSuperUser: false } };

function fixtures(o: { sameWorkout?: boolean; delivered?: boolean } = {}) {
  tables = {
    athletes: { data: { id: A, name: 'Avi', status: 'active', group_id: G3, pending_group_id: null, pending_group_from: null, garmin_auth: null }, error: null },
    groups: { data: [{ id: G1, name: 'SUB 2:30', pace_profile: { marathonGoal: 150 } }, { id: G2, name: 'SUB 2:35', pace_profile: { marathonGoal: 155 } }, { id: G3, name: 'SUB 2:45', pace_profile: { marathonGoal: 165 } }], error: null },
    weekly_plans: { data: { id: 'plan-1', parsed_workouts: { group1: { workouts: [workout(5)] }, group2: { workouts: [workout(o.sameWorkout ? 3 : 4)] }, group3: { workouts: [workout(3)] } } }, error: null },
    workout_deliveries: { data: o.delivered === false ? [] : [{ workout_date: today }], error: null },
  };
}
const post = async (body: unknown) => (await import('@/app/api/admin/pack-move/route')).POST(
  new Request('http://x/api/admin/pack-move', { method: 'POST', body: JSON.stringify(body) }),
);

beforeEach(() => {
  fixtures();
  rpcResult = { data: { status: 'moved', from_group_id: G3, to_group_id: G2, move_id: 'mv-1' }, error: null };
  rpcCalls.length = 0; writes.length = 0; afterQueue.length = 0;
  afterPackMove.mockClear();
  requireStaffCaller.mockReset().mockResolvedValue(coach);
});

describe('previewWatchEffect', () => {
  it('a different workout today, already on the watch → re-sent', async () => {
    const { previewWatchEffect } = await import('@/lib/groups/pack-move');
    expect(await previewWatchEffect(fakeDb as never, { athleteId: A, fromGroupId: G3, toGroupId: G2, fromDate: today }))
      .toMatchObject({ fromKey: 'group3', toKey: 'group2', onWatchDays: [dow], resendDays: [dow], reason: 'resend' });
  });
  it('same workout, other paces → nothing re-sent; nothing on the watch → nothing to fix', async () => {
    const { previewWatchEffect } = await import('@/lib/groups/pack-move');
    fixtures({ sameWorkout: true });
    expect((await previewWatchEffect(fakeDb as never, { athleteId: A, fromGroupId: G3, toGroupId: G2, fromDate: today }))?.reason).toBe('same_workouts');
    fixtures({ delivered: false });
    expect((await previewWatchEffect(fakeDb as never, { athleteId: A, fromGroupId: G3, toGroupId: G2, fromDate: today }))?.reason).toBe('nothing_on_watch');
  });
});

describe('POST /api/admin/pack-move', () => {
  it('dry run: the effect summary, nothing written, no function call', async () => {
    const res = await post({ athleteId: A, toGroupId: G2, dryRun: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dryRun: true, moved: false, from: { id: G3, lane: 3 }, to: { id: G2, lane: 2 }, watch: { resendDays: [dow], reason: 'resend' }, notifiesRunner: true });
    expect(rpcCalls).toHaveLength(0);
    expect(writes).toEqual([]);
    expect(afterQueue).toHaveLength(0);
  });

  it('the move is one function call (with the caller as the audit actor), then the watch + push after the response', async () => {
    const res = await post({ athleteId: A, toGroupId: G2, reason: 'faster lately' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ moved: true, moveId: 'mv-1' });
    expect(rpcCalls).toEqual([{ fn: 'move_athlete_group', args: expect.objectContaining({ p_athlete_id: A, p_to_group_id: G2, p_by_athlete_id: 'coach-1', p_by_email: 'c@x', p_reason: 'faster lately', p_from_date: today }) }]);
    expect(writes).toEqual([]);                  // no direct table writes: only the function writes
    await Promise.all(afterQueue.map((f) => f()));
    expect(afterPackMove).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ athleteId: A, fromGroupId: G3, toGroupId: G2, by: 'coach', historyWritten: true }));
  });

  it('409 without migration 326 — never a half move', async () => {
    rpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.move_athlete_group' } };
    expect((await post({ athleteId: A, toGroupId: G2 })).status).toBe(409);
    expect(afterQueue).toHaveLength(0);
  });

  it('409 when someone else moved them first (the function saw no change)', async () => {
    rpcResult = { data: { status: 'unchanged', from_group_id: G2 }, error: null };
    expect((await post({ athleteId: A, toGroupId: G2 })).status).toBe(409);
    expect(afterQueue).toHaveLength(0);
  });

  it('refuses: same pack, unknown pack, removed member, not in the club, viewing as', async () => {
    expect((await post({ athleteId: A, toGroupId: G3 })).status).toBe(409);
    expect((await post({ athleteId: A, toGroupId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).status).toBe(400);
    tables.athletes = { data: { id: A, status: 'removed', group_id: G3 }, error: null };
    expect((await post({ athleteId: A, toGroupId: G2 })).status).toBe(409);
    tables.athletes = { data: null, error: null };
    expect((await post({ athleteId: A, toGroupId: G2 })).status).toBe(404);
    requireStaffCaller.mockResolvedValue({ denied: null, caller: { ...coach.caller, viewingAsBy: 'boss' } });
    expect((await post({ athleteId: A, toGroupId: G2 })).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('staff gate', async () => {
    requireStaffCaller.mockResolvedValue({ denied: new Response('no', { status: 403 }), caller: {} });
    expect((await post({ athleteId: A, toGroupId: G2 })).status).toBe(403);
  });
});

describe('migration 326', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/326_athlete_group_moves.sql'), 'utf8');
  it('is idempotent and locks the row', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS athlete_group_moves/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION move_athlete_group/);
    expect(sql).toMatch(/FOR UPDATE/);
  });
  it('no FK to groups (a second athletes↔groups embed path, see 145)', () => {
    expect(sql).not.toMatch(/REFERENCES groups/);
  });
});
