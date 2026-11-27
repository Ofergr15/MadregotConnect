import { describe, expect, it, vi, afterEach } from 'vitest';
import { describeSwallowed, noteSwallowed, swallow, swallowAs } from '@/lib/errors/swallowed';

afterEach(() => vi.restoreAllMocks());

describe('swallowed errors are logged, never rethrown', () => {
  it('describes name, code and message only, masking emails', () => {
    const e = Object.assign(new Error('no row for ofer@x.com'), { code: '42P01', config: { data: 'password=1' } });
    const d = describeSwallowed(e);
    expect(d).toBe('Error 42P01 no row for [email]');
    expect(d).not.toContain('password');
    expect(describeSwallowed({ code: 'PGRST116', message: 'x' })).toBe('Error PGRST116 x');
    expect(describeSwallowed(null)).toBe('unknown');
    expect(describeSwallowed('boom')).toBe('Error boom');
  });
  it('noteSwallowed writes one warn line and never throws, even if console does', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    noteSwallowed('push.prefs', new TypeError('bad'));
    expect(warn).toHaveBeenCalledWith('[swallowed] push.prefs: TypeError bad');
    warn.mockImplementation(() => { throw new Error('console gone'); });
    expect(() => noteSwallowed('x', 1)).not.toThrow();
  });
  it('swallow / swallowAs keep the old fallback values', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(Promise.reject(new Error('x')).catch(swallow('a'))).resolves.toBeUndefined();
    await expect(Promise.reject(new Error('x')).catch(swallowAs('b', null))).resolves.toBeNull();
    await expect(Promise.reject(new Error('x')).catch(swallowAs('c', [] as string[]))).resolves.toEqual([]);
  });
});

describe('src/lib has no bare empty catch on the server paths fixed in task 65', () => {
  it('plan-builder retry loop reports a failed version instead of `catch {}`', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/lib/plan-builder/server.ts', 'utf8');
    expect(src).not.toMatch(/catch\s*\{\s*\}/);
    expect(src).toContain('planPushRetryFailed');
  });
});
