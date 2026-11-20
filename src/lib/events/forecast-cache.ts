import type { ForecastDay } from '@/lib/events/forecast';

/**
 * Last good provider answer per event+coords+range, in this instance's memory: when Open-Meteo is down
 * or slow, a recent forecast (≤ 6 h old) is served with `stale: true` instead of a 502. Bounded: at most
 * 200 entries, oldest evicted first. Never invents data: a missing day stays `error`.
 */
export const STALE_MAX_MS = 6 * 3_600_000;
export const STALE_MAX_ENTRIES = 200;
const lastGood = new Map<string, { at: number; days: ForecastDay[] }>();

export function rememberForecast(key: string, days: ForecastDay[], now = Date.now()): void {
  lastGood.delete(key);
  lastGood.set(key, { at: now, days });
  while (lastGood.size > STALE_MAX_ENTRIES) lastGood.delete(lastGood.keys().next().value as string);
}

export function staleForecast(key: string, now = Date.now()): { at: number; days: ForecastDay[] } | null {
  const prev = lastGood.get(key);
  return prev && now - prev.at <= STALE_MAX_MS ? prev : null;
}

export function resetForecastCache(): void { lastGood.clear(); }
export function forecastCacheSize(): number { return lastGood.size; }
