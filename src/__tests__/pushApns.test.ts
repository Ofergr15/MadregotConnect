import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const sendApns = vi.fn();
let configured: object | null = { host: 'h' };
vi.mock('@/lib/apns', async (orig) => ({
  ...(await orig<typeof import('@/lib/apns')>()),
  apnsConfig: () => configured,
  sendApns: (...args: unknown[]) => sendApns(...args),
}));

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  setVapidDetails: vi.fn(),
  sendNotification: (...args: unknown[]) => sendNotification(...args),
}));

// Rows each table hands back, and every write the code under test performs.
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
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        lt: () => chain,
        neq: () => chain,
        is: () => chain,
        not: () => chain,
        or: () => chain,
        in: (_col: string, values: unknown[]) => { ids = values; return chain; },
        update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return chain; },
        delete: () => { op = 'delete'; return chain; },
        insert: (rows: Array<Record<string, unknown>>) => {
          writes.inserted.push({ table, rows });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () => Promise.resolve({ data: (tables[table] || [])[0] ?? null, error: null }),
        // Thenable, so the same chain serves a filtered read and a terminal
        // update/delete — exactly how the real supabase-js builder behaves.
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (op === 'update') writes.updated.push({ table, patch, ids });
          if (op === 'delete') writes.deleted.push({ table, ids });
          const data = op === 'select' ? (tables[table] || []) : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  }),
}));


const { sendPushDetailed, subscriptionsForAthletes } = await import('@/lib/push');

const web = (id: string, a: string) => ({ id, endpoint: `https://web.push.apple.com/${id}`, p256dh: 'p', auth: 'a', athlete_id: a });
const ios = (id: string, a: string) => ({ id, endpoint: 'apns', p256dh: '', auth: '', athlete_id: a, apns_token: 'ab'.repeat(32) });

beforeEach(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  configured = { host: 'h' };
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  sendApns.mockReset().mockResolvedValue({ ok: true, status: 200, reason: null, dead: false });
  writes = { updated: [], deleted: [], inserted: [] };
  tables = {
    app_settings: [{ key: 'maintenance_mode', value: 'off' }],
    athletes: [{ id: 'a1', email: 'a1@x.test', status: 'active', notification_prefs: null, group_id: null, last_seen_at: null }],
    scheduled_notifications: [],
    push_subscriptions: [],
    athlete_devices: [],
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T12:00:00+02:00'));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const deliveries = () => writes.inserted.filter((w) => w.table === 'push_deliveries').flatMap((w) => w.rows);

describe('APNs fan-out alongside web-push', () => {
  it('sends iOS devices through APNs and web subs through web-push, one delivery row each', async () => {
    const r = await sendPushDetailed([web('w1', 'a1'), ios('d1', 'a1')], { title: 'hi', body: 'x', url: '/feed', kind: 'kudos' });
    expect(r).toEqual({ sent: 2, byAthlete: { a1: 2 } });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendApns).toHaveBeenCalledTimes(1);
    const [, token, payload] = sendApns.mock.calls[0];
    expect(token).toBe('ab'.repeat(32));
    expect(payload).toMatchObject({ url: '/feed', athleteId: 'a1', aps: { alert: { title: 'hi', body: 'x' } } });
    const rows = deliveries();
    expect(rows.map((d) => [d.subscription_id, d.accepted])).toEqual(expect.arrayContaining([['w1', true], ['d1', true]]));
    expect(new Set(rows.map((d) => d.nid)).size).toBe(1);
  });

  it('a rejected APNs send is recorded with its reason; 410 clears the token', async () => {
    sendApns.mockResolvedValue({ ok: false, status: 410, reason: 'Unregistered', dead: true });
    const r = await sendPushDetailed([ios('d1', 'a1')], { title: 'hi', body: 'x' });
    expect(r.sent).toBe(0);
    expect(deliveries()[0]).toMatchObject({ subscription_id: 'd1', accepted: false, error: 'apns:410 Unregistered' });
    expect(writes.updated).toContainEqual({ table: 'athlete_devices', patch: { apns_token: null }, ids: ['d1'] });
  });

  it('APNs throwing/failing never blocks web-push', async () => {
    sendApns.mockResolvedValue({ ok: false, status: 0, reason: 'ECONNRESET', dead: false });
    const r = await sendPushDetailed([ios('d1', 'a1'), web('w1', 'a1')], { title: 'hi', body: 'x' });
    expect(r.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('APNs still goes out when VAPID keys are missing', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    vi.resetModules();
    const fresh = await import('@/lib/push');
    const r = await fresh.sendPushDetailed([ios('d1', 'a1'), web('w1', 'a1')], { title: 'hi', body: 'x' });
    expect(r.sent).toBe(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('without APNs env: iOS devices are not even looked up, and web-push is unchanged', async () => {
    configured = null;
    tables.athlete_devices = [{ id: 'd1', athlete_id: 'a1', apns_token: 'ab'.repeat(32) }];
    tables.push_subscriptions = [web('w1', 'a1')];
    const subs = await subscriptionsForAthletes(['a1']);
    expect(subs.map((s) => s.id)).toEqual(['w1']);
  });

  it('with APNs env: subscriptionsForAthletes adds the athlete\'s iOS devices', async () => {
    tables.athlete_devices = [{ id: 'd1', athlete_id: 'a1', apns_token: 'ab'.repeat(32) }];
    tables.push_subscriptions = [web('w1', 'a1')];
    const subs = await subscriptionsForAthletes(['a1']);
    expect(subs.map((s) => s.id)).toEqual(['w1', 'd1']);
    expect(subs[1]).toMatchObject({ apns_token: 'ab'.repeat(32) });
  });
});
