import { describe, expect, it, vi } from 'vitest';
import { errorFields, formatLog, scrub } from '@/lib/observability/log';
import { requestIdOf } from '@/lib/observability/request-id';
import { startCronRun } from '@/lib/observability/cron-run';

describe('structured log — no PII', () => {
  it('redacts person and credential keys, at any depth', () => {
    const out = JSON.parse(formatLog('info', 'x', {
      athleteId: 'a-1', email: 'r@x.com', name: 'רועי', user: { full_name: 'X', phone: '050', garmin_auth: 'blob' },
      token: 't', lat: 32.1, lng: 34.8, count: 3,
    }));
    expect(out).toMatchObject({ level: 'info', event: 'x', athleteId: 'a-1', count: 3 });
    for (const v of [out.email, out.name, out.user.full_name, out.user.phone, out.user.garmin_auth, out.token, out.lat, out.lng]) {
      expect(v).toBe('[redacted]');
    }
  });
  it('masks email addresses inside free text', () => {
    expect(scrub('failed for ofer@example.com today')).toBe('failed for [email] today');
  });
  it('reduces an error to name + scrubbed message, never stack or config', () => {
    const e = Object.assign(new Error('login a@b.co failed'), { config: { data: 'password=hunter2' }, code: '42P01' });
    const f = errorFields(e);
    // An axios-like error (it carries `config`) gets no stack at all.
    expect(f).toEqual({ errorName: 'Error', message: 'login [email] failed', code: '42P01' });
    expect(JSON.stringify(scrub({ err: e }))).not.toContain('hunter2');
    expect(errorFields('plain')).toEqual({ errorName: 'Error', message: 'plain' });
  });
  it('keeps the first frames of a plain error stack, scrubbed', () => {
    const e = new Error('boom');
    e.stack = ['Error: boom', ...Array.from({ length: 12 }, (_, i) => `    at fn${i} (/var/task/x.js:${i}:1)`),
      '    at https://u:secretpw@api.example.com/x (r@x.com)'].join('\n');
    const f = errorFields(e);
    expect(f.stack).toHaveLength(8);
    expect(f.stack?.[0]).toBe('at fn0 (/var/task/x.js:0:1)');
    const g = new Error('boom');
    g.stack = 'Error: boom\n    at https://u:secretpw@api.example.com/x (r@x.com)';
    expect(errorFields(g).stack).toEqual(['at https://[credentials]@api.example.com/x ([email])']);
    expect(errorFields(new Error('real')).stack?.length).toBeGreaterThan(0);
  });
  it('drops the stack of axios / fetch / network errors, and their credentials', () => {
    const axiosLike = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true, name: 'AxiosError',
      config: { url: 'https://connect.garmin.com/signin', headers: { Authorization: 'Bearer tok123' }, data: 'password=hunter2' },
    });
    axiosLike.stack = 'AxiosError: Request failed\n    at https://connect.garmin.com/signin?password=hunter2';
    const fetchErr = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) });
    const sock = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    for (const err of [axiosLike, fetchErr, sock]) {
      const f = errorFields(err);
      expect(f.stack).toBeUndefined();
      const line = formatLog('error', 'x', { err });
      expect(line).not.toMatch(/hunter2|tok123|Bearer|garmin\.com|"stack"/);
    }
  });
  it('caps long strings and deep objects', () => {
    expect((scrub('x'.repeat(1000)) as string).length).toBeLessThan(310);
    expect(JSON.stringify(scrub({ a: { b: { c: { d: { e: 1 } } } } }))).toContain('[depth]');
  });
});

describe('request id', () => {
  it('keeps a safe caller id, falls back to Vercel, else generates', () => {
    expect(requestIdOf({ headers: new Headers({ 'x-request-id': 'abc-123456' }) })).toBe('abc-123456');
    expect(requestIdOf({ headers: new Headers({ 'x-request-id': '<script>', 'x-vercel-id': 'fra1::xyz-1' }) })).toBe('fra1::xyz-1');
    expect(requestIdOf({ headers: new Headers() })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('cron run summary', () => {
  it('collects failed steps into one summary line', () => {
    const logs: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((l) => { logs.push(String(l)); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let t = 1000;
    const run = startCronRun('tick', 'rid-1', () => t);
    run.fail('pushes', new Error('boom for x@y.io'));
    t = 1250;
    const s = run.finish({ fired: 2 });
    expect(s).toEqual({
      cron: 'tick', requestId: 'rid-1', durationMs: 250, ok: false, failedCount: 1,
      failed: [{ step: 'pushes', errorName: 'Error', message: 'boom for [email]' }],
    });
    expect(JSON.parse(logs[0])).toMatchObject({ event: 'cron.summary', failedCount: 1, fired: 2 });
    warn.mockRestore(); err.mockRestore();
  });
  it('a clean run logs info and ok=true', () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(startCronRun('sync').finish().ok).toBe(true);
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });
});
