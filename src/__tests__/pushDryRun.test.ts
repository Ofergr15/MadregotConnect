import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Task 196: a dry run walks the real send pipeline and writes the real per-device
// delivery log, but nothing leaves the process — and a simulated 404/410 prunes the
// dead token exactly as a real one does.

// Deliberately NO VAPID keys and NO APNs config: a dry run must not need them.
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) }));
const sendApns = vi.fn();
vi.mock('@/lib/apns', async (orig) => ({ ...(await orig<object>()), apnsConfig: () => null, sendApns: (...a: unknown[]) => sendApns(...a) }));

type Tables = Record<string, Array<Record<string, unknown>>>;
let tables: Tables;
let writes: { updated: Array<{ table: string; patch: Record<string, unknown>; ids: unknown[] }>; deleted: Array<{ table: string; ids: unknown[] }>; inserted: Array<{ table: string; rows: Array<Record<string, unknown>> }> };

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from(table: string) {
      let op = 'select';
      let patch: Record<string, unknown> = {};
      let ids: unknown[] = [];
      const chain = {
        select: () => chain, eq: () => chain, gt: () => chain, lt: () => chain, neq: () => chain, or: () => chain,
        in: (_c: string, v: unknown[]) => { ids = v; return chain; },
        update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return chain; },
        delete: () => { op = 'delete'; return chain; },
        insert: (rows: Array<Record<string, unknown>>) => { writes.inserted.push({ table, rows }); return Promise.resolve({ data: null, error: null }); },
        maybeSingle: () => Promise.resolve({ data: (tables[table] || [])[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          if (op === 'update') writes.updated.push({ table, patch, ids });
          if (op === 'delete') writes.deleted.push({ table, ids });
          return Promise.resolve({ data: op === 'select' ? (tables[table] || []) : null, error: null }).then(res, rej);
        },
      };
      return chain;
    },
  }),
}));

const { sendPushDetailed } = await import('@/lib/push');
const { setPushDryRun, pushDryRunTransport, DRY_RUN_MARK } = await import('@/lib/push-dry-run');
const { stateOf } = await import('@/lib/push-deliveries');

const web = (id: string, athleteId: string) => ({ id, endpoint: `https://web.push.apple.com/${id}`, p256dh: 'p', auth: 'a', athlete_id: athleteId });
const ios = (id: string, athleteId: string) => ({ ...web(id, athleteId), apns_token: `tok-${id}` });
const deliveryRows = () => writes.inserted.filter((w) => w.table === 'push_deliveries').flatMap((w) => w.rows);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  tables = {};
  writes = { updated: [], deleted: [], inserted: [] };
  sendNotification.mockReset();
  sendApns.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { setPushDryRun(null); warn.mockRestore(); vi.unstubAllEnvs(); });

describe('push dry run', () => {
  it('sends nothing, logs one delivery row per device, counts per athlete', async () => {
    const seen: Array<{ subscriptionId: string; channel: string; body: string }> = [];
    setPushDryRun((d) => { seen.push(d); return { ok: true }; });
    const r = await sendPushDetailed([web('w1', 'a1'), ios('i1', 'a1'), web('w2', 'a2')], { title: 'Hi', body: 'x', badge: 1, kind: 'test_kind' });

    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendApns).not.toHaveBeenCalled();
    expect(r).toEqual({ sent: 3, byAthlete: { a1: 2, a2: 1 } });
    expect(seen.map((d) => [d.subscriptionId, d.channel])).toEqual([['w1', 'webpush'], ['i1', 'apns'], ['w2', 'webpush']]);
    // The device gets the same JSON body a real send would carry.
    expect(JSON.parse(seen[0].body)).toMatchObject({ title: 'Hi', athleteId: 'a1', badge: 1 });

    const rows = deliveryRows();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((x) => x.nid)).size).toBe(1);
    expect(rows.every((x) => x.accepted === true && x.error === DRY_RUN_MARK && x.kind === 'test_kind')).toBe(true);
  });

  it('per-device results: 410 web and 410 APNs are pruned, a 500 is kept and reported', async () => {
    setPushDryRun((d) => (d.subscriptionId === 'dead-web' || d.subscriptionId === 'dead-ios' ? { ok: false, status: 410 } : d.subscriptionId === 'flaky' ? { ok: false, status: 500 } : { ok: true }));
    const r = await sendPushDetailed([web('live', 'a1'), web('dead-web', 'a1'), ios('dead-ios', 'a2'), web('flaky', 'a3')], { title: 'T', body: 'b', badge: 1 });

    expect(r.sent).toBe(1);
    expect(r.byAthlete).toEqual({ a1: 1 });
    expect(writes.deleted).toEqual([{ table: 'push_subscriptions', ids: ['dead-web'] }]);
    expect(writes.updated).toEqual([{ table: 'athlete_devices', patch: { apns_token: null }, ids: ['dead-ios'] }]);

    const byId = Object.fromEntries(deliveryRows().map((x) => [x.subscription_id, x]));
    expect(byId.live).toMatchObject({ accepted: true, error: 'dry-run' });
    expect(byId['dead-web']).toMatchObject({ accepted: false, error: 'dry-run:410' });
    expect(byId['dead-ios']).toMatchObject({ accepted: false, error: 'dry-run:410' });
    expect(byId.flaky).toMatchObject({ accepted: false, error: 'dry-run:500' });
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('dry-run:flaky=500'))).toBe(true);
  });

  it('a 404 prunes too', async () => {
    setPushDryRun(() => ({ ok: false, status: 404 }));
    await sendPushDetailed([web('gone', 'a1')], { title: 'T', body: 'b', badge: 1 });
    expect(writes.deleted).toEqual([{ table: 'push_subscriptions', ids: ['gone'] }]);
  });

  it('PUSH_DRY_RUN=1 accepts every device and never prunes', async () => {
    vi.stubEnv('PUSH_DRY_RUN', '1');
    expect(pushDryRunTransport()).not.toBeNull();
    const r = await sendPushDetailed([web('w1', 'a1'), ios('i1', 'a2')], { title: 'T', body: 'b', badge: 1 });
    expect(r.sent).toBe(2);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(writes.deleted).toEqual([]);
    expect(writes.updated).toEqual([]);
  });

  it('off by default: without the env or a simulator the real transport is used', () => {
    vi.stubEnv('PUSH_DRY_RUN', '');
    expect(pushDryRunTransport()).toBeNull();
  });

  it('push health never judges a dry-run row', () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    expect(stateOf({ accepted: true, error: 'dry-run', shown_at: null, sent_at: old })).toBe('muted');
    expect(stateOf({ accepted: false, error: 'dry-run:410', shown_at: null, sent_at: old })).toBe('muted');
    expect(stateOf({ accepted: true, error: null, shown_at: null, sent_at: old })).toBe('not_shown');
  });
});
