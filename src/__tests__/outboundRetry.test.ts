import { describe, expect, it, vi } from 'vitest';
import { OutboundTimeoutError } from '@/lib/http/timeout';
import {
  RETRY_POLICY,
  backoffMs,
  classifyResponse,
  isRetryable,
  parseRetryAfter,
  sdkMaxRetries,
  withRetry,
  type RetryPolicy,
} from '@/lib/http/retry';
import { classifyResendResult } from '@/lib/email/transport';
import { sendApns } from '@/lib/apns';

const P: RetryPolicy = { attempts: 3, baseMs: 100, maxMs: 1000 };
const noSleep = { sleep: async () => {}, random: () => 0.5, policy: P };
const errWith = (code: string) => Object.assign(new Error(code), { code });

describe('isRetryable — the one rule', () => {
  it('429 and 503 always; other 5xx only when idempotent; 4xx never', () => {
    for (const idem of [true, false]) {
      expect(isRetryable({ kind: 'status', status: 429 }, idem)).toBe(true);
      expect(isRetryable({ kind: 'status', status: 503 }, idem)).toBe(true);
      expect(isRetryable({ kind: 'status', status: 400 }, idem)).toBe(false);
      expect(isRetryable({ kind: 'status', status: 401 }, idem)).toBe(false);
      expect(isRetryable({ kind: 'status', status: 404 }, idem)).toBe(false);
    }
    expect(isRetryable({ kind: 'status', status: 500 }, true)).toBe(true);
    expect(isRetryable({ kind: 'status', status: 502 }, true)).toBe(true);
    expect(isRetryable({ kind: 'status', status: 500 }, false)).toBe(false);
  });
  it('never-sent network errors always; maybe-sent ones and timeouts only when idempotent', () => {
    expect(isRetryable({ kind: 'error', error: errWith('ECONNREFUSED') }, false)).toBe(true);
    expect(isRetryable({ kind: 'error', error: errWith('ENOTFOUND') }, false)).toBe(true);
    expect(isRetryable({ kind: 'error', error: errWith('ECONNRESET') }, false)).toBe(false);
    expect(isRetryable({ kind: 'error', error: errWith('ECONNRESET') }, true)).toBe(true);
    expect(isRetryable({ kind: 'error', error: new OutboundTimeoutError('strava', 15000) }, false)).toBe(false);
    expect(isRetryable({ kind: 'error', error: new OutboundTimeoutError('strava', 15000) }, true)).toBe(true);
    const undici = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
    expect(isRetryable({ kind: 'error', error: undici }, true)).toBe(true);
    expect(isRetryable({ kind: 'error', error: new Error('bad json') }, true)).toBe(false);
  });
});

describe('backoff', () => {
  it('full jitter, exponential, capped', () => {
    expect(backoffMs(P, 1, () => 0.999)).toBe(99);
    expect(backoffMs(P, 2, () => 0.999)).toBe(199);
    expect(backoffMs(P, 10, () => 0.999)).toBe(999);
    expect(backoffMs(P, 3, () => 0)).toBe(0);
  });
  it('Retry-After wins, still capped', () => {
    expect(backoffMs(P, 1, Math.random, 300)).toBe(300);
    expect(backoffMs(P, 1, Math.random, 60_000)).toBe(1000);
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('withRetry', () => {
  it('retries a 503 Response, then returns the success', async () => {
    const work = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await withRetry<Response>('strava', work, { idempotent: true, classify: classifyResponse, ...noSleep });
    expect(res.status).toBe(200);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it('out of tries → the LAST Response is returned, not thrown', async () => {
    const work = vi.fn(async () => new Response('', { status: 502 }));
    const res = await withRetry<Response>('strava', work, { idempotent: true, classify: classifyResponse, ...noSleep });
    expect(res.status).toBe(502);
    expect(work).toHaveBeenCalledTimes(3);
  });
  it('out of tries → the last error is re-thrown as is', async () => {
    const e = errWith('ECONNREFUSED');
    await expect(withRetry('webpush', async () => { throw e; }, { idempotent: false, ...noSleep })).rejects.toBe(e);
  });
  it('non-idempotent timeout: one try only', async () => {
    const work = vi.fn(async () => { throw new OutboundTimeoutError('webpush', 10000); });
    await expect(withRetry('webpush', work, { idempotent: false, ...noSleep })).rejects.toBeInstanceOf(OutboundTimeoutError);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('noRetryStatuses: Strava 429 is not repeated', async () => {
    const work = vi.fn(async () => new Response('', { status: 429 }));
    await withRetry('strava', work, { idempotent: true, classify: classifyResponse, noRetryStatuses: [429], ...noSleep });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('a thrown SDK error with statusCode (web-push) is judged by status, honouring retry-after', async () => {
    const sleep = vi.fn(async () => {});
    const err = Object.assign(new Error('rate'), { statusCode: 429, headers: { 'retry-after': '0' } });
    const work = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('sent');
    expect(await withRetry('webpush', work, { idempotent: false, sleep, policy: P })).toBe('sent');
    const gone = Object.assign(new Error('gone'), { statusCode: 410 });
    const w2 = vi.fn(async () => { throw gone; });
    await expect(withRetry('webpush', w2, { idempotent: false, sleep, policy: P })).rejects.toBe(gone);
    expect(w2).toHaveBeenCalledTimes(1);
  });
  it('sleeps the backoff between tries and reports each retry', async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const work = vi.fn(async () => new Response('', { status: 503 }));
    await withRetry('strava', work, { idempotent: true, classify: classifyResponse, sleep, random: () => 0.5, policy: P, onRetry });
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([50, 100]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
  it('Garmin never retries (SSO lockouts; #230 owns its back-off)', async () => {
    expect(RETRY_POLICY.garmin.attempts).toBe(1);
    const work = vi.fn(async () => { throw errWith('ECONNREFUSED'); });
    await expect(withRetry('garmin', work, { idempotent: true, sleep: async () => {} })).rejects.toThrow();
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('Anthropic: the SDK does the retrying, the count comes from the table', () => {
    expect(sdkMaxRetries('anthropic')).toBe(RETRY_POLICY.anthropic.attempts - 1);
  });
});

describe('call sites', () => {
  it('Resend results: rate limit and server errors retry, validation/quota do not', () => {
    expect(classifyResendResult({ data: { id: 'x' }, error: null })).toEqual({ kind: 'ok' });
    expect(classifyResendResult({ data: null, error: { name: 'rate_limit_exceeded' } })).toEqual({ kind: 'status', status: 429 });
    expect(classifyResendResult({ data: null, error: { name: 'internal_server_error' } })).toEqual({ kind: 'status', status: 500 });
    expect(classifyResendResult({ data: null, error: { name: 'daily_quota_exceeded' } })).toEqual({ kind: 'status', status: 400 });
    expect(classifyResendResult({ data: null, error: { name: 'validation_error' } })).toEqual({ kind: 'status', status: 400 });
  });

  it('APNs: 503 is retried once, 500 and 410 are not', async () => {
    const { generateKeyPairSync } = await import('crypto');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const cfg = { keyId: 'K', teamId: 'T', bundleId: 'b', host: 'api.push.apple.com', key: privateKey };
    const statuses = [503, 200];
    const t1 = vi.fn(async () => ({ status: statuses.shift()!, body: '' }));
    const r1 = await sendApns(cfg, 'tok', {}, { transport: t1, retrySleep: async () => {} });
    expect(r1.ok).toBe(true);
    expect(t1).toHaveBeenCalledTimes(2);
    for (const status of [500, 410]) {
      const t = vi.fn(async () => ({ status, body: '{"reason":"x"}' }));
      const r = await sendApns(cfg, 'tok', {}, { transport: t, retrySleep: async () => {} });
      expect(r.ok).toBe(false);
      expect(t).toHaveBeenCalledTimes(1);
    }
  });
});
