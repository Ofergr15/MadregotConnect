import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildDTO, parseOpenMeteo, usableForecast, type UnavailableReason } from '@/lib/events/forecast';

/**
 * docs/contracts/fixtures/event-forecast.v2.states.json — one exact v2 body per state the native client must
 * render, all from the REAL buildDTO/parseOpenMeteo. SYNTHETIC weather. Fails on any drift (UPDATE_FIXTURE=1).
 */
const FILE = join(process.cwd(), 'docs/contracts/fixtures/event-forecast.v2.states.json');
const EVENT = '00000000-0000-4000-8000-00000000e001';
const VALENCIA = { lat: 39.4699, lng: -0.3763 };
const FETCHED = Date.parse('2026-11-21T10:00:00Z');
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function provider(from: string, o: { days?: number; nullDates?: string[]; tz?: unknown; offset?: unknown; raceHours?: string } = {}) {
  const dates = Array.from({ length: o.days ?? 16 }, (_, i) => addDays(from, i));
  const v = (x: number) => dates.map((d) => (o.nullDates?.includes(d) ? null : x));
  const hours = o.raceHours ? [6, 7, 8, 9, 10].map((h) => `${o.raceHours}T${String(h).padStart(2, '0')}:00`) : [];
  return {
    ...(o.tz === undefined ? { timezone: 'Europe/Madrid' } : o.tz === null ? {} : { timezone: o.tz }),
    ...(o.offset === undefined ? { utc_offset_seconds: 3600 } : o.offset === null ? {} : { utc_offset_seconds: o.offset }),
    current: { time: `${from}T11:00`, temperature_2m: 17.2, apparent_temperature: 16.1, precipitation: 0, wind_speed_10m: 9.4, weather_code: 1 },
    daily: { time: dates, temperature_2m_max: v(18), temperature_2m_min: v(9), precipitation_probability_max: v(20), wind_speed_10m_max: v(15), weather_code: v(3) },
    hourly: { time: hours, temperature_2m: hours.map(() => 11), precipitation_probability: hours.map(() => 10),
      wind_speed_10m: hours.map(() => 8), weather_code: hours.map(() => 2) },
  };
}
const dto = (raceDates: string[], json: unknown, extra: { stale?: boolean; reason?: UnavailableReason; fetchedAt?: number | null; noCoords?: boolean } = {}) => {
  const f = json === null ? null : parseOpenMeteo(json);
  const forecast = f && usableForecast(f) ? f : null;
  return buildDTO({ eventId: EVENT, lat: extra.noCoords ? null : VALENCIA.lat, lng: extra.noCoords ? null : VALENCIA.lng, raceDates,
    forecast, fetchedAt: forecast ? (extra.fetchedAt ?? FETCHED) : null, stale: !!extra.stale,
    unavailableReason: extra.reason ?? (forecast || extra.noCoords ? (extra.noCoords ? 'no_location' : null) : 'invalid_payload') });
};
const trimDaily = <T extends { daily: unknown[] }>(d: T) => ({ ...d, daily: d.daily.slice(0, 2), _dailyTrimmedTo2Of: d.daily.length });

const STATES = {
  available_race_day: trimDaily(dto(['2026-12-06'], provider('2026-11-21', { raceHours: '2026-12-06' }))),
  out_of_range_after_horizon: trimDaily(dto(['2026-12-06'], provider('2026-11-20'))),
  partial_multi_day: trimDaily(dto(['2026-12-06', '2026-12-07'], provider('2026-11-21'))),
  no_data_null_race_day: trimDaily(dto(['2026-12-06'], provider('2026-11-21', { nullDates: ['2026-12-06'] }))),
  current_only: dto(['2026-12-06'], { timezone: 'Europe/Madrid', utc_offset_seconds: 3600, current: { time: '2026-11-21T11:00', temperature_2m: 16 } }),
  timezone_missing_offset_present: trimDaily(dto(['2026-12-06'], provider('2026-11-21', { tz: null }))),
  timezone_invalid_and_offset_invalid: trimDaily(dto(['2026-12-06'], provider('2026-11-21', { tz: 'Fake/Zone', offset: 99999 }))),
  stale_after_provider_error: trimDaily(dto(['2026-12-06'], provider('2026-11-21'), { stale: true, fetchedAt: Date.parse('2026-11-21T07:30:00Z') })),
  invalid_payload: dto(['2026-12-06'], { daily: { time: [] } }),
  rate_limited_no_cache: dto(['2026-12-06'], null, { reason: 'rate_limited' }),
  timeout_no_cache: dto(['2026-12-06'], null, { reason: 'timeout' }),
  no_location: dto(['2026-12-06'], null, { noCoords: true }),
};

describe('event forecast v2 state fixtures (native parity)', () => {
  it('matches the fixture file', () => {
    const json = JSON.stringify({ _note: 'Synthetic weather. Exact GET /api/events/:id/forecast v2 bodies, one per state, from the real buildDTO. daily[] trimmed to 2 entries where marked (_dailyTrimmedTo2Of; not a response field).', ...STATES }, null, 2) + '\n';
    if (process.env.UPDATE_FIXTURE === '1' || !existsSync(FILE)) writeFileSync(FILE, json);
    expect(readFileSync(FILE, 'utf8')).toBe(json);
  });
  it('each state says what it claims', () => {
    expect(STATES.available_race_day).toMatchObject({ raceDayStatus: 'available', unavailableReason: null });
    expect(STATES.available_race_day.raceHourly.map((h) => h.time)).toContain('2026-12-06T08:00');
    expect(STATES.out_of_range_after_horizon).toMatchObject({ raceDayStatus: 'out_of_range', raceDayReason: 'after_horizon', validThrough: '2026-12-05' });
    expect(STATES.partial_multi_day).toMatchObject({ raceDayStatus: 'partial', raceDayReason: 'after_horizon' });
    expect(STATES.no_data_null_race_day).toMatchObject({ raceDayStatus: 'unavailable', raceDayReason: 'no_data', days: [{ date: '2026-12-06', status: 'error' }] });
    expect(STATES.current_only).toMatchObject({ current: { temperatureC: 16, windKmh: null }, daily: [], validFrom: null, raceDayStatus: 'unavailable', unavailableReason: null });
    expect(STATES.timezone_missing_offset_present).toMatchObject({ timezone: null, utcOffsetSec: 3600 });
    expect(STATES.timezone_invalid_and_offset_invalid).toMatchObject({ timezone: null, utcOffsetSec: null });
    expect(STATES.stale_after_provider_error).toMatchObject({ stale: true, fetchedAt: '2026-11-21T07:30:00.000Z', unavailableReason: null });
    for (const k of ['invalid_payload', 'rate_limited_no_cache', 'timeout_no_cache'] as const) {
      expect(STATES[k]).toMatchObject({ current: null, daily: [], raceDayStatus: 'unavailable', fetchedAt: null, stale: false, status: 'ok', days: [{ status: 'error' }] });
    }
    expect(STATES.invalid_payload.unavailableReason).toBe('invalid_payload');
    expect(STATES.no_location).toMatchObject({ location: null, status: 'no_location', days: [], unavailableReason: 'no_location' });
  });
});
