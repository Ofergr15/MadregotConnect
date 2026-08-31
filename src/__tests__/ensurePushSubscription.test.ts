import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensurePushSubscription, subscribeToPush } from '@/lib/pwa';

// apiHeaders reaches for localStorage and a real Supabase client for the session
// token, neither of which exists here. Stubbed so the POST still carries a
// bearer header — /api/push/subscribe gates athleteId on the verified session
// now, so a credential-less save is a 401 and this device goes silent.
vi.mock('@/lib/api', () => ({
  apiHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' })),
}));

// The client half of the same failure: iOS can drop a device's PushManager
// subscription while Notification.permission stays 'granted', and every
// existing code path bailed out the moment it saw 'granted' — so the one state
// that needed repair was the one state with no way out of it. This function is
// the repair, and it runs on app open, which makes its guard rails
// (never prompt, never unsubscribe) as important as its happy path.

const VAPID = Buffer.from(new Uint8Array(65).fill(7)).toString('base64url');

let subscribeMock: ReturnType<typeof vi.fn>;
let getSubscriptionMock: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

const liveSubscription = (endpoint: string) => ({
  endpoint,
  unsubscribe: vi.fn(),
  toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
});

function setup(opts: { permission?: string; existing?: ReturnType<typeof liveSubscription> | null; vapid?: string } = {}) {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = opts.vapid === undefined ? VAPID : opts.vapid;
  getSubscriptionMock = vi.fn().mockResolvedValue(opts.existing ?? null);
  subscribeMock = vi.fn().mockResolvedValue(liveSubscription('https://web.push.apple.com/fresh'));
  requestPermission = vi.fn();
  fetchMock = vi.fn().mockResolvedValue({ ok: true });

  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone)',
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription: getSubscriptionMock, subscribe: subscribeMock },
      }),
    },
  });
  vi.stubGlobal('window', { PushManager: function PushManager() {} });
  vi.stubGlobal('Notification', { permission: opts.permission ?? 'granted', requestPermission });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => vi.unstubAllGlobals());

describe('ensurePushSubscription', () => {
  it('re-posts an existing subscription so the server marks it live', async () => {
    setup({ existing: liveSubscription('https://web.push.apple.com/already-here') });
    const result = await ensurePushSubscription('a1');

    expect(result).toEqual({ ok: true, action: 'refreshed' });
    expect(subscribeMock).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/push/subscribe');
    const sent = JSON.parse(init.body);
    expect(sent.athleteId).toBe('a1');
    expect(sent.subscription.endpoint).toBe('https://web.push.apple.com/already-here');
    // user_agent is what lets the server identify this device and reap its orphans.
    expect(sent.userAgent).toBe('Mozilla/5.0 (iPhone)');
  });

  it('never unsubscribes the working subscription it found', async () => {
    // subscribeToPush deliberately unsubscribes first (it wants a brand-new
    // endpoint); doing that here — on every app open — would churn a new
    // endpoint daily and leave orphans behind exactly like the original bug.
    const existing = liveSubscription('https://web.push.apple.com/already-here');
    setup({ existing });
    await ensurePushSubscription('a1');
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it('subscribes when iOS dropped the subscription behind our back', async () => {
    setup({ existing: null });
    const result = await ensurePushSubscription('a1');

    expect(result).toEqual({ ok: true, action: 'resubscribed' });
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subscription.endpoint)
      .toBe('https://web.push.apple.com/fresh');
  });

  it('never prompts for permission — an app open must not raise a system dialog', async () => {
    setup({ permission: 'default' });
    const result = await ensurePushSubscription('a1');

    expect(result).toEqual({ ok: false, action: 'skipped', error: 'not_granted' });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a denied permission without touching the push manager', async () => {
    setup({ permission: 'denied' });
    expect(await ensurePushSubscription('a1')).toEqual({ ok: false, action: 'skipped', error: 'not_granted' });
    expect(getSubscriptionMock).not.toHaveBeenCalled();
  });

  it('reports a failed save instead of silently claiming success', async () => {
    setup({ existing: liveSubscription('https://web.push.apple.com/already-here') });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await ensurePushSubscription('a1')).toEqual({ ok: false, error: 'save_failed_500', action: 'refreshed' });
  });

  it('skips when no athlete is known yet', async () => {
    setup();
    expect(await ensurePushSubscription('')).toEqual({ ok: false, action: 'skipped', error: 'no_athlete' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips when the VAPID key is missing rather than throwing into the caller', async () => {
    setup({ vapid: '' });
    expect(await ensurePushSubscription('a1')).toEqual({ ok: false, action: 'skipped', error: 'missing_vapid' });
  });

  it('swallows a thrown subscribe and returns the reason — this runs on every app open', async () => {
    setup({ existing: null });
    subscribeMock.mockRejectedValue(new Error('AbortError: registration failed'));
    const result = await ensurePushSubscription('a1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('AbortError');
  });

  it('sends the session bearer token — without it the save 401s and the device goes silent', async () => {
    // The route now gates athleteId on the verified session. This POST used to
    // send Content-Type and nothing else, which is exactly why the route could
    // only "know" who was subscribing by trusting the id in the body.
    setup({ existing: liveSubscription('https://web.push.apple.com/already-here') });
    await ensurePushSubscription('a1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('sends no replacesEndpoint — it never discards anything, so there is nothing to retire', async () => {
    setup({ existing: liveSubscription('https://web.push.apple.com/already-here') });
    await ensurePushSubscription('a1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).replacesEndpoint).toBeUndefined();
  });
});

describe('subscribeToPush — naming the endpoint it discards', () => {
  it('tells the server which endpoint this one supersedes', async () => {
    // The server cannot infer this: Apple keeps answering 201 for the old
    // endpoint, so it never reports itself dead and would linger forever,
    // silently inflating every delivery count for this athlete.
    const existing = liveSubscription('https://web.push.apple.com/superseded');
    setup({ existing });
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });

    const result = await subscribeToPush('a1');
    expect(result.ok).toBe(true);
    expect(existing.unsubscribe).toHaveBeenCalled();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.replacesEndpoint).toBe('https://web.push.apple.com/superseded');
    expect(sent.subscription.endpoint).toBe('https://web.push.apple.com/fresh');
  });

  it('omits replacesEndpoint when there was no prior subscription to discard', async () => {
    setup({ existing: null });
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });

    await subscribeToPush('a1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).replacesEndpoint).toBeUndefined();
  });

  it('still subscribes when unsubscribing the old one throws, and reports no predecessor it failed to drop', async () => {
    // iOS can throw unsubscribing a subscription left in a weird state, and
    // that must never block getting a working new one. The endpoint is captured
    // before the unsubscribe attempt, so it is still named for retirement.
    const existing = liveSubscription('https://web.push.apple.com/wedged');
    existing.unsubscribe = vi.fn().mockRejectedValue(new Error('InvalidStateError'));
    setup({ existing });
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') });

    const result = await subscribeToPush('a1');
    expect(result.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).replacesEndpoint).toBe('https://web.push.apple.com/wedged');
  });
});
