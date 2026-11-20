import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * notifyAthlete × native push (APNs). With APNs unconfigured — the default everywhere today —
 * the native module is never even loaded, and the result is the web-only one. Configured, the
 * athlete's iPhone deliveries count, and an athlete with only the app is not logged "no-device".
 */

const writes: Array<{ table: string; op: string; row: unknown }> = [];
function chain(table: string): any {
  const c: any = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'or', 'gte', 'gt', 'lte', 'lt', 'not', 'order', 'limit', 'filter', 'match', 'contains']) c[m] = () => c;
  for (const m of ['insert', 'upsert', 'update', 'delete']) c[m] = (row: unknown) => { writes.push({ table, op: m, row }); return c; };
  c.maybeSingle = async () => ({ data: null, error: null });
  c.single = async () => ({ data: null, error: null });
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej);
  return c;
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (t: string) => chain(t), rpc: async () => ({ data: null, error: null }) }) }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) } }));

let configured = false;
vi.mock('@/lib/apns', async (orig) => ({ ...(await orig<typeof import('@/lib/apns')>()), apnsConfig: () => (configured ? ({} as never) : null) }));
const nativeSend = vi.fn();
vi.mock('@/lib/push-native', () => ({ sendPushNativeToAthletes: (...a: unknown[]) => nativeSend(...a) }));

const { notifyAthlete } = await import('@/lib/push');

beforeEach(() => { writes.length = 0; configured = false; nativeSend.mockReset(); });

describe('notifyAthlete and native push', () => {
  it('APNs off: native is never called; an athlete with no subscription is logged no-device', async () => {
    const r = await notifyAthlete({ athleteId: 'a1', kind: 'like', title: 't', body: 'b', url: '/feed' });
    expect(nativeSend).not.toHaveBeenCalled();
    expect(r).toEqual({ subscriptions: 0, delivered: 0 });
    expect(JSON.stringify(writes)).toContain('no-device');
  });
  it('APNs on: the iPhone delivery counts and no "no-device" row is written', async () => {
    configured = true;
    nativeSend.mockResolvedValue({ sent: 1, byAthlete: { a1: 1 }, cleared: 0, configured: true });
    const r = await notifyAthlete({ athleteId: 'a1', kind: 'like', title: 't', body: 'b', url: '/feed', category: 'teammates' as never });
    expect(nativeSend).toHaveBeenCalledWith(['a1'], expect.objectContaining({ kind: 'like', title: 't', body: 'b', url: '/feed', category: 'teammates' }));
    expect(r.delivered).toBe(1);
    expect(JSON.stringify(writes)).not.toContain('no-device');
  });
  it('APNs on but the native send throws: still best-effort, the web-only result stands', async () => {
    configured = true;
    nativeSend.mockRejectedValue(new Error('boom'));
    const r = await notifyAthlete({ athleteId: 'a1', kind: 'like', title: 't', body: 'b', url: '/feed' });
    expect(r).toEqual({ subscriptions: 0, delivered: 0 });
  });
});
