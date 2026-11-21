/**
 * Weather at a session's start — for the native השבוע tab's top card (Ofer, 2026-11-21:
 * only on group-practice days and the long run; the client decides which days ask).
 *
 * Open-Meteo forecast, no key. Cached per place (lat/lon rounded to 0.01°, ~1 km) and
 * local hour, so a whole squad opening the tab costs one upstream call per hour.
 * `time` is Israel wall-clock `YYYY-MM-DDTHH:MM` — the same shape as a plan's start time.
 */

export interface WeatherAt {
  time: string;          // YYYY-MM-DDTHH:00, Israel local
  tempC: number;
  feelsC: number | null;
  humidity: number | null;
  precipProb: number | null;
  windKmh: number | null;
  /** WMO weather code (0 clear … 95 thunder). */
  code: number | null;
}

export function parseQuery(q: URLSearchParams): { lat: number; lon: number; date: string; hour: number } | string {
  const lat = Number(q.get('lat')), lon = Number(q.get('lon')), time = q.get('time') || '';
  if (!q.get('lat') || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'lat';
  if (!q.get('lon') || !Number.isFinite(lon) || lon < -180 || lon > 180) return 'lon';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}$/.exec(time);
  if (!m || Number(m[2]) > 23) return 'time';
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, date: m[1], hour: Number(m[2]) };
}

/** Forecast covers today … +15 days; anything else is not answerable. */
export function inRange(date: string, today: string): boolean {
  const d = Date.parse(`${date}T00:00:00Z`), t = Date.parse(`${today}T00:00:00Z`);
  return d >= t && d <= t + 15 * 86_400_000;
}

const cache = new Map<string, { at: number; value: WeatherAt | null }>();
const TTL_MS = 60 * 60_000;

export function cacheKey(lat: number, lon: number, date: string, hour: number) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}@${date}T${hour}`;
}

export function pickHour(j: any, date: string, hour: number): WeatherAt | null {
  const h = j?.hourly; if (!h?.time) return null;
  const key = `${date}T${String(hour).padStart(2, '0')}:00`;
  const i = (h.time as string[]).indexOf(key);
  if (i < 0 || h.temperature_2m?.[i] == null) return null;
  const n = (a: unknown[] | undefined) => (a?.[i] == null ? null : Number(a[i]));
  return { time: key, tempC: Number(h.temperature_2m[i]), feelsC: n(h.apparent_temperature), humidity: n(h.relative_humidity_2m),
    precipProb: n(h.precipitation_probability), windKmh: n(h.wind_speed_10m), code: n(h.weather_code) };
}

export async function weatherAt(lat: number, lon: number, date: string, hour: number,
  fetcher: typeof fetch = fetch, now = Date.now()): Promise<WeatherAt | null> {
  const k = cacheKey(lat, lon, date, hour);
  const hit = cache.get(k);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const q = `latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,wind_speed_10m,weather_code&timezone=Asia%2FJerusalem&start_date=${date}&end_date=${date}`;
  try {
    const res = await fetcher(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;                       // upstream trouble is not cached
    const value = pickHour(await res.json(), date, hour);
    cache.set(k, { at: now, value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
  } catch { return null; }
}

export function __resetWeatherCache() { cache.clear(); }
