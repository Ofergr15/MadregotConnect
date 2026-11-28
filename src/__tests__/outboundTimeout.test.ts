import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OUTBOUND_TIMEOUT_MS,
  OutboundTimeoutError,
  asOutboundError,
  fetchWithTimeout,
  isOutboundTimeoutError,
  looksLikeTimeout,
  withTimeout,
} from '@/lib/http/timeout';
import { setGarminTimeout } from '@/lib/garmin/client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OUTBOUND_TIMEOUT_MS', () => {
  it('has a positive budget for every service', () => {
    for (const ms of Object.values(OUTBOUND_TIMEOUT_MS)) expect(ms).toBeGreaterThan(0);
    expect(Object.keys(OUTBOUND_TIMEOUT_MS).sort()).toEqual(['anthropic', 'apns', 'garmin', 'resend', 'strava', 'webpush']);
  });
});

describe('fetchWithTimeout', () => {
  it('passes a signal and returns the response', async () => {
    const fetchMock = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithTimeout('strava', 'https://example.test/x', { method: 'POST' });
    expect(await res.text()).toBe('ok');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('throws OutboundTimeoutError when the upstream hangs past the budget', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    const err = await fetchWithTimeout('strava', 'https://example.test/x', {}, 20).catch((e) => e);
    expect(isOutboundTimeoutError(err)).toBe(true);
    expect(err).toMatchObject({ code: 'outbound_timeout', service: 'strava', timeoutMs: 20 });
  });

  it('keeps a non-timeout network error as is', async () => {
    const boom = new TypeError('fetch failed');
    vi.stubGlobal('fetch', async () => { throw boom; });
    await expect(fetchWithTimeout('garmin', 'https://example.test')).rejects.toBe(boom);
  });

  it('honours the caller abort signal too', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const ctrl = new AbortController();
    const p = fetchWithTimeout('strava', 'https://example.test', { signal: ctrl.signal }, 10_000);
    ctrl.abort();
    const err = await p.catch((e) => e);
    expect(isOutboundTimeoutError(err)).toBe(false);
    expect(err.name).toBe('AbortError');
  });
});

describe('withTimeout', () => {
  it('resolves when the work finishes first', async () => {
    await expect(withTimeout('resend', Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('rejects with a typed error when the work hangs', async () => {
    vi.useFakeTimers();
    const p = withTimeout('webpush', new Promise(() => {}), 100);
    vi.advanceTimersByTime(101);
    await expect(p).rejects.toBeInstanceOf(OutboundTimeoutError);
  });

  it('passes the work rejection through', async () => {
    await expect(withTimeout('resend', Promise.reject(new Error('refused')), 50)).rejects.toThrow('refused');
  });
});

describe('looksLikeTimeout / asOutboundError', () => {
  it.each([
    [{ name: 'TimeoutError' }],
    [{ code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' }],
    [{ name: 'APIConnectionTimeoutError', message: 'Request timed out.' }],
    [new OutboundTimeoutError('apns', 1)],
  ])('recognises %o', (e) => {
    expect(looksLikeTimeout(e)).toBe(true);
    expect(asOutboundError(e, 'garmin')).toBeInstanceOf(OutboundTimeoutError);
  });

  it('leaves other errors alone', () => {
    const e = new Error('401 Unauthorized');
    expect(looksLikeTimeout(e)).toBe(false);
    expect(looksLikeTimeout(null)).toBe(false);
    expect(asOutboundError(e, 'strava')).toBe(e);
  });
});

describe('setGarminTimeout', () => {
  it('sets the axios default inside the garmin-connect client', () => {
    const gc = { client: { client: { defaults: {} as { timeout?: number } } } };
    expect(setGarminTimeout(gc, 1234)).toBe(true);
    expect(gc.client.client.defaults.timeout).toBe(1234);
  });

  it('is a no-op on an unexpected shape', () => {
    expect(setGarminTimeout({}, 1)).toBe(false);
    expect(setGarminTimeout(null, 1)).toBe(false);
  });

  it('reaches the real garmin-connect HttpClient', async () => {
    const { GarminConnect } = await import('garmin-connect');
    const gc = new GarminConnect({ username: 'x@example.test', password: '' });
    expect(setGarminTimeout(gc, 4321)).toBe(true);
  });
});
