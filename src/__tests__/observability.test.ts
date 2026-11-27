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
    expect(f).toEqual({ errorName: 'Error', message: 'login [email] failed', code: '42P01' });
    expect(JSON.stringify(scrub({ err: e }))).not.toContain('hunter2');
    expect(errorFields('plain')).toEqual({ errorName: 'Error', message: 'plain' });
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
