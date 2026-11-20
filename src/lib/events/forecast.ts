/** Daily event forecast from Open-Meteo — pure helpers (no I/O). */

/** Open-Meteo's daily forecast reaches today + 15 (16 days inclusive). */
export const FORECAST_HORIZON_DAYS = 16;
const MAX_RANGE_DAYS = 31;

export type ForecastDay =
  | { date: string; status: 'available'; tMaxC: number | null; tMinC: number | null; precipProbPct: number | null; windMaxKmh: number | null; weatherCode: number | null }
  | { date: string; status: 'not_yet_available' | 'past' | 'error' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD dates from start..end (end missing/earlier → just start). Capped. */
export function eventDateRange(start: string, end?: string | null): string[] {
  const s = String(start).slice(0, 10);
  if (!DATE_RE.test(s)) return [];
  const e = end ? String(end).slice(0, 10) : s;
  const out = [s];
  if (!DATE_RE.test(e) || e <= s) return out;
  let cur = s;
  while (out.length < MAX_RANGE_DAYS) {
    cur = addDays(cur, 1);
    if (cur > e) break;
    out.push(cur);
  }
  return out;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type HorizonClass = 'past' | 'in_range' | 'not_yet_available';

export function classifyDate(date: string, today: string): HorizonClass {
  if (date < today) return 'past';
  if (date > addDays(today, FORECAST_HORIZON_DAYS - 1)) return 'not_yet_available';
  return 'in_range';
}

export function buildForecastUrl(lat: number, lng: number, startDate: string, endDate: string): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code',
    timezone: 'auto',
    start_date: startDate,
    end_date: endDate,
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Map Open-Meteo JSON to per-date days. A requested date missing from the payload → 'error' (never invented). */
export function mapOpenMeteoDaily(json: unknown, dates: string[]): ForecastDay[] {
  const d = (json as OpenMeteoDaily | null)?.daily;
  const time = Array.isArray(d?.time) ? d.time : [];
  return dates.map((date): ForecastDay => {
    const i = time.indexOf(date);
    if (i < 0) return { date, status: 'error' };
    return {
      date,
      status: 'available',
      tMaxC: num(d?.temperature_2m_max?.[i]),
      tMinC: num(d?.temperature_2m_min?.[i]),
      precipProbPct: num(d?.precipitation_probability_max?.[i]),
      windMaxKmh: num(d?.wind_speed_10m_max?.[i]),
      weatherCode: num(d?.weather_code?.[i]),
    };
  });
}
