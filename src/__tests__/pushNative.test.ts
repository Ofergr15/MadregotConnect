import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { apnsConfig, resetProviderToken, type ApnsTransport } from '@/lib/apns';

/**
 * sendPushNative mirrors the web-push path (lib/push.ts sendPushDetailed) for iPhone devices.
 * The shared filters and the delivery log are mocked; the APNs HTTP layer is a mock transport.
 * Nothing reaches Apple.
 */

const recorded: Array<Record<string, unknown>> = [];
const muted = new Set<string>();
const walledOff = new Set<string>();
vi.mock('@/lib/push', () => ({
  filterForMaintenance: async <T extends { athlete_id: string }>(xs: T[]) => xs.filter((x) => !walledOff.has(x.athlete_id)),
  filterByCategory: async <T extends { athlete_id: string }>(xs: T[], category?: string) => (category ? xs.filter((x) => !muted.has(x.athlete_id)) : xs),
  computeUnreadCounts: async (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, i + 4])),
  recordDeliveries: async (rows: Array<Record<string, unknown>>) => { recorded.push(...rows); },
}));
const cleared: string[][] = [];
const deviceRows: Array<{ id: string; athlete_id: string; apns_token: string }> = [];
vi.mock('@/lib/watch/devices', () => ({
  clearApnsTokens: async (_db: unknown, ids: string[]) => { cleared.push(ids); },
  nativeDevicesForAthletes: vi.fn(async () => deviceRows),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));

const { sendPushNative, sendPushNativeToAthletes } = await import('@/lib/push-native');
const devicesLib = await import('@/lib/watch/devices');

const PEM = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CFG = apnsConfig({ APNS_KEY_P8: PEM, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'club.madregot.app', APNS_ENV: 'sandbox' })!;
const tok = (c: string) => c.repeat(64);
const A = { id: 'dev-a', athlete_id: 'ath-1', apns_token: tok('a') };
const B = { id: 'dev-b', athlete_id: 'ath-2', apns_token: tok('b') };
const C = { id: 'dev-c', athlete_id: 'ath-3', apns_token: tok('c') };

beforeEach(() => {
  recorded.length = 0; cleared.length = 0; muted.clear(); walledOff.clear(); deviceRows.length = 0;
  resetProviderToken();
  vi.mocked(devicesLib.nativeDevicesForAthletes).mockClear();
});

describe('sendPushNative', () => {
  it('APNs off (no config): nothing sent, nothing recorded, no transport call', async () => {
    const transport = vi.fn<ApnsTransport>(async () => ({ status: 200, body: '' }));
    const r = await sendPushNative([A, B], { title: 't', body: 'b' }, { config: null, transport });
    expect(r).toEqual({ sent: 0, byAthlete: {}, cleared: 0, configured: false });
    expect(transport).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('sends one push per device with each athlete’s own badge, and logs one delivery row each', async () => {
    const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
    const transport: ApnsTransport = async (req) => { bodies.push({ path: req.path, body: JSON.parse(req.body) }); return { status: 200, body: '' }; };
    const r = await sendPushNative([A, B], { title: 'שלום', body: 'גוף', url: '/feed', kind: 'news' }, { config: CFG, transport });
    expect(r).toMatchObject({ sent: 2, byAthlete: { 'ath-1': 1, 'ath-2': 1 }, cleared: 0, configured: true });
    const byPath = Object.fromEntries(bodies.map((b) => [b.path, b.body]));
    expect((byPath[`/3/device/${tok('a')}`] as any).aps.badge).toBe(4);
    expect((byPath[`/3/device/${tok('b')}`] as any).aps.badge).toBe(5);
    expect((byPath[`/3/device/${tok('a')}`] as any)).toMatchObject({ url: '/feed', athleteId: 'ath-1', kind: 'news' });
    expect(recorded).toHaveLength(2);
    expect(recorded.every((d) => d.subscription_id === null && d.accepted === true && d.kind === 'news')).toBe(true);
    expect(new Set(recorded.map((d) => d.nid)).size).toBe(1); // one push, one nid across devices
  });

  it('410 / BadDeviceToken clear those devices’ tokens; a 503 leaves its token alone', async () => {
    const transport: ApnsTransport = async (req) => {
      if (req.path.endsWith(tok('a'))) return { status: 410, body: '{"reason":"Unregistered"}' };
      if (req.path.endsWith(tok('b'))) return { status: 400, body: '{"reason":"BadDeviceToken"}' };
      return { status: 503, body: '{"reason":"ServiceUnavailable"}' };
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await sendPushNative([A, B, C], { title: 't', body: 'b' }, { config: CFG, transport });
    warn.mockRestore();
    expect(r.sent).toBe(0);
    expect(r.cleared).toBe(2);
    expect(cleared).toEqual([[expect.any(String), expect.any(String)]]);
    expect(new Set(cleared[0])).toEqual(new Set(['dev-a', 'dev-b']));
    expect(recorded.map((d) => d.error).sort()).toEqual(['apns:400:BadDeviceToken', 'apns:410:Unregistered', 'apns:503:ServiceUnavailable']);
  });

  it('maintenance and muted categories are filtered exactly like web push, and logged', async () => {
    walledOff.add('ath-1'); muted.add('ath-2');
    const transport = vi.fn<ApnsTransport>(async () => ({ status: 200, body: '' }));
    const r = await sendPushNative([A, B, C], { title: 't', body: 'b', category: 'teammates' as never }, { config: CFG, transport });
    expect(r.sent).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(recorded.map((d) => d.error).sort()).toEqual(['apns:maintenance', 'apns:muted', null].sort() as never);
  });

  it('a pinned badge is sent as is', async () => {
    let badge: unknown;
    await sendPushNative([A], { title: 't', body: 'b', badge: 9 }, { config: CFG, transport: async (req) => { badge = JSON.parse(req.body).aps.badge; return { status: 200, body: '' }; } });
    expect(badge).toBe(9);
  });
});

describe('sendPushNativeToAthletes', () => {
  it('off: does not even read the device table', async () => {
    const r = await sendPushNativeToAthletes(['ath-1'], { title: 't', body: 'b' }, { config: null });
    expect(r.configured).toBe(false);
    expect(devicesLib.nativeDevicesForAthletes).not.toHaveBeenCalled();
  });
  it('on: reads the athletes’ devices and sends to them', async () => {
    deviceRows.push(A);
    const r = await sendPushNativeToAthletes(['ath-1'], { title: 't', body: 'b' }, { config: CFG, transport: async () => ({ status: 200, body: '' }) });
    expect(r.sent).toBe(1);
    expect(devicesLib.nativeDevicesForAthletes).toHaveBeenCalledWith(expect.anything(), ['ath-1']);
  });
});
