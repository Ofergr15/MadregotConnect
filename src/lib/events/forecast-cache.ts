import type { VenueForecast } from '@/lib/events/forecast';

/**
 * Per-venue provider answers, in this instance's memory. Bounded (STALE_MAX_ENTRIES, oldest evicted).
 *  - FRESH_MS: younger than this, served without asking the provider again.
 *  - STALE_MAX_MS: when the provider fails (error, 429, timeout), a copy up to this old is served with
 *    `stale: true`; older than that, the answer is "unavailable", never old weather forever.
 *  - Concurrent misses for one venue share ONE request (coalesced).
 */
export const FRESH_MS = 30 * 60_000;
export const STALE_MAX_MS = 6 * 3_600_000;
export const STALE_MAX_ENTRIES = 200;

type Entry = { at: number; forecast: VenueForecast };
const lastGood = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();

export const venueKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export function rememberForecast(key: string, forecast: VenueForecast, now = Date.now()): Entry {
  const e = { at: now, forecast };
  lastGood.delete(key);
  lastGood.set(key, e);
  while (lastGood.size > STALE_MAX_ENTRIES) lastGood.delete(lastGood.keys().next().value as string);
  return e;
}
export function freshForecast(key: string, now = Date.now()): Entry | null {
  const e = lastGood.get(key);
  return e && now - e.at < FRESH_MS ? e : null;
}
export function staleForecast(key: string, now = Date.now()): Entry | null {
  const e = lastGood.get(key);
  return e && now - e.at <= STALE_MAX_MS ? e : null;
}
/** One provider request per venue at a time; later callers await the same promise. */
export function coalesce(key: string, run: () => Promise<Entry>): Promise<Entry> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
export function resetForecastCache(): void { lastGood.clear(); inFlight.clear(); }
export function forecastCacheSize(): number { return lastGood.size; }
