import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout, TimeoutError } from '@/lib/with-timeout';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('passes a value through when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('passes a rejection through unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError when the promise never settles (hung getSession / fetch)', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const p = withTimeout(never, 8_000, 'getSession');
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });
});
