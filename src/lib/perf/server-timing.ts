import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * `Server-Timing` for the hot routes, so the client (and the native app's
 * request log) can see where a slow response spent its time without anyone
 * reading Vercel logs.
 *
 * DATA EXPOSURE: the header carries metric NAMES and DURATIONS only — never a
 * `desc`, never an id, an email, a row count or anything else derived from the
 * request or the data. Names are fixed strings chosen in code and are still
 * sanitised to `[a-z0-9_-]`, so a future caller can't smuggle a value through
 * one. Pinned by src/__tests__/serverTiming.test.ts.
 */

interface Store {
  marks: Array<{ name: string; dur: number }>;
}

const als = new AsyncLocalStorage<Store>();

const now = () => performance.now();

export function sanitizeMetricName(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return clean || 'step';
}

/** Record a duration (ms) against the current request, if it is being timed. */
export function recordTiming(name: string, dur: number): void {
  const store = als.getStore();
  if (!store || !Number.isFinite(dur)) return;
  store.marks.push({ name: sanitizeMetricName(name), dur });
}

/** Time `fn` as a named phase of the current request. A no-op outside one. */
export async function timeStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!als.getStore()) return fn();
  const t0 = now();
  try {
    return await fn();
  } finally {
    recordTiming(name, now() - t0);
  }
}

export function formatServerTiming(marks: Array<{ name: string; dur: number }>): string {
  return marks.map((m) => `${sanitizeMetricName(m.name)};dur=${Math.max(0, m.dur).toFixed(1)}`).join(', ');
}

/**
 * Wrap a route handler: every phase recorded with `timeStep` / `recordTiming`
 * while it runs (the session check records `auth` on its own) plus `total`
 * lands in one `Server-Timing` header on whatever Response it returns.
 */
export function withServerTiming<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return (...args: A) => {
    const store: Store = { marks: [] };
    return als.run(store, async () => {
      const t0 = now();
      const res = await handler(...args);
      const marks = [...store.marks, { name: 'total', dur: now() - t0 }];
      try {
        res.headers.set('Server-Timing', formatServerTiming(marks));
      } catch {
        // An immutable Response (e.g. a fetched one passed through) — skip, never fail the request.
      }
      return res;
    });
  };
}
