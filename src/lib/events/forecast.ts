/**
 * Event weather from Open-Meteo: pure helpers (no I/O).
 *
 * One request per venue: `forecast_days=16` in the venue's own timezone (`timezone=auto`). Which days
 * exist is read from what the provider RETURNS (`daily.time`), never computed from this server's
 * clock. That is what makes "today" the venue's today: a server in UTC and a venue at UTC+1 disagree
 * for an hour every night, and the provider's own dates settle it.
 *
 * Unknown stays `null`, never 0: a missing wind speed is not a calm day.
 */
export const FORECAST_DAYS = 16;
const MAX_RANGE_DAYS = 31;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PROVIDER = 'open-meteo' as const;
export const ATTRIBUTION = { name: 'Open-Meteo', url: 'https://open-meteo.com/' } as const;

export type RaceDayStatus = 'available' | 'partial' | 'out_of_range' | 'unavailable';
export type RaceDayReason = 'after_horizon' | 'before_horizon' | null;
export type UnavailableReason = 'no_location' | 'provider_error' | 'rate_limited' | 'timeout' | null;

export interface CurrentWeather {
  time: string | null;
  temperatureC: number | null;
  apparentC: number | null;
  precipitationMm: number | null;
  windKmh: number | null;
  weatherCode: number | null;
}
export interface DailyWeather {
  date: string;
  tMaxC: number | null;
  tMinC: number | null;
  precipProbPct: number | null;
  windMaxKmh: number | null;
  weatherCode: number | null;
}
export interface HourlyWeather {
  /** Venue-local wall time as the provider returns it ("2026-12-06T08:00"). */
  time: string;
  temperatureC: number | null;
  precipProbPct: number | null;
  windKmh: number | null;
  weatherCode: number | null;
}

/** What the provider returned, parsed. Venue-independent of the event: cached per venue. */
export interface VenueForecast {
  timezone: string | null;
  utcOffsetSec: number | null;
  validFrom: string | null;
  validThrough: string | null;
  current: CurrentWeather | null;
  daily: DailyWeather[];
  hourly: HourlyWeather[];
}

/** The v1 per-day shape (docs/contracts/valencia.md), still emitted for parsers built on it. */
export type LegacyDay =
  | { date: string; status: 'available'; tMaxC: number | null; tMinC: number | null; precipProbPct: number | null; windMaxKmh: number | null; weatherCode: number | null }
  | { date: string; status: 'not_yet_available' | 'past' | 'error' };

export interface EventForecastDTO {
  /** 2 = this shape. v1 fields `status` and `days` are kept below so a v1 parser keeps working. */
  version: 2;
  /** v1: 'no_location' without coordinates, else 'ok' (a provider failure shows as days with status 'error'). */
  status: 'ok' | 'no_location';
  /** v1: one entry per race date. */
  days: LegacyDay[];
  provider: typeof PROVIDER;
  attribution: typeof ATTRIBUTION;
  eventId: string;
  location: { lat: number; lng: number } | null;
  timezone: string | null;
  fetchedAt: string | null;
  stale: boolean;
  validFrom: string | null;
  validThrough: string | null;
  current: CurrentWeather | null;
  daily: DailyWeather[];
  raceDate: string;
  raceDates: string[];
  raceDayStatus: RaceDayStatus;
  raceDayReason: RaceDayReason;
  /** The race day(s)' hours, venue-local, only when the provider returned them. */
  raceHourly: HourlyWeather[];
  unavailableReason: UnavailableReason;
}

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

export function buildForecastUrl(lat: number, lng: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
    current: 'temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,weather_code',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const at = (arr: unknown, i: number) => (Array.isArray(arr) ? arr[i] : undefined);

/** Provider JSON → VenueForecast. Days are exactly the dates returned; nothing is filled in. */
export function parseOpenMeteo(json: unknown): VenueForecast {
  const j = (json ?? {}) as Record<string, any>;
  const d = j.daily ?? {};
  const times: string[] = Array.isArray(d.time) ? d.time.filter((t: unknown) => typeof t === 'string' && DATE_RE.test(t)) : [];
  const daily: DailyWeather[] = times.map((date) => {
    const i = (d.time as unknown[]).indexOf(date);
    return {
      date,
      tMaxC: num(at(d.temperature_2m_max, i)),
      tMinC: num(at(d.temperature_2m_min, i)),
      precipProbPct: num(at(d.precipitation_probability_max, i)),
      windMaxKmh: num(at(d.wind_speed_10m_max, i)),
      weatherCode: num(at(d.weather_code, i)),
    };
  });
  const h = j.hourly ?? {};
  const htimes: unknown[] = Array.isArray(h.time) ? h.time : [];
  const hourly: HourlyWeather[] = htimes.flatMap((t, i) => (typeof t === 'string' ? [{
    time: t,
    temperatureC: num(at(h.temperature_2m, i)),
    precipProbPct: num(at(h.precipitation_probability, i)),
    windKmh: num(at(h.wind_speed_10m, i)),
    weatherCode: num(at(h.weather_code, i)),
  }] : []));
  const c = j.current;
  const current: CurrentWeather | null = c && typeof c === 'object' ? {
    time: str(c.time),
    temperatureC: num(c.temperature_2m),
    apparentC: num(c.apparent_temperature),
    precipitationMm: num(c.precipitation),
    windKmh: num(c.wind_speed_10m),
    weatherCode: num(c.weather_code),
  } : null;
  return {
    timezone: str(j.timezone),
    utcOffsetSec: num(j.utc_offset_seconds),
    validFrom: times[0] ?? null,
    validThrough: times[times.length - 1] ?? null,
    current,
    daily,
    hourly,
  };
}

/** Race-day readiness from the RETURNED window, not from a promised horizon. */
export function raceDayOf(raceDates: string[], f: Pick<VenueForecast, 'daily' | 'validFrom' | 'validThrough'>):
  { status: RaceDayStatus; reason: RaceDayReason } {
  if (raceDates.length === 0 || !f.validFrom || !f.validThrough) return { status: 'unavailable', reason: null };
  const have = new Set(f.daily.map((x) => x.date));
  const covered = raceDates.filter((x) => have.has(x)).length;
  if (covered === raceDates.length) return { status: 'available', reason: null };
  if (covered > 0) return { status: 'partial', reason: raceDates[raceDates.length - 1] > f.validThrough ? 'after_horizon' : null };
  if (raceDates[0] > f.validThrough) return { status: 'out_of_range', reason: 'after_horizon' };
  if (raceDates[raceDates.length - 1] < f.validFrom) return { status: 'out_of_range', reason: 'before_horizon' };
  return { status: 'unavailable', reason: null }; // inside the window but the provider omitted it
}

export function buildDTO(args: {
  eventId: string; lat: number | null; lng: number | null; raceDates: string[];
  forecast: VenueForecast | null; fetchedAt: number | null; stale: boolean; unavailableReason: UnavailableReason;
}): EventForecastDTO {
  const f = args.forecast;
  const race = f ? raceDayOf(args.raceDates, f) : { status: 'unavailable' as const, reason: null };
  const raceSet = new Set(args.raceDates);
  const byDate = new Map((f?.daily ?? []).map((x) => [x.date, x]));
  const days: LegacyDay[] = args.raceDates.map((date): LegacyDay => {
    const d = byDate.get(date);
    if (d) return { status: 'available', ...d };
    if (f?.validThrough && date > f.validThrough) return { date, status: 'not_yet_available' };
    if (f?.validFrom && date < f.validFrom) return { date, status: 'past' };
    return { date, status: 'error' };
  });
  return {
    version: 2,
    status: args.unavailableReason === 'no_location' ? 'no_location' : 'ok',
    days: args.unavailableReason === 'no_location' ? [] : days,
    provider: PROVIDER,
    attribution: ATTRIBUTION,
    eventId: args.eventId,
    location: args.lat != null && args.lng != null ? { lat: args.lat, lng: args.lng } : null,
    timezone: f?.timezone ?? null,
    fetchedAt: args.fetchedAt != null ? new Date(args.fetchedAt).toISOString() : null,
    stale: args.stale,
    validFrom: f?.validFrom ?? null,
    validThrough: f?.validThrough ?? null,
    current: f?.current ?? null,
    daily: f?.daily ?? [],
    raceDate: args.raceDates[0] ?? '',
    raceDates: args.raceDates,
    raceDayStatus: race.status,
    raceDayReason: race.reason,
    raceHourly: f ? f.hourly.filter((x) => raceSet.has(x.time.slice(0, 10))) : [],
    unavailableReason: args.unavailableReason,
  };
}
