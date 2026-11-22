import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/events/[id]/forecast — synthetic provider payloads only (no network). Valencia-shaped:
 * race Sunday 2026-12-06, venue Europe/Madrid. Readiness comes from the dates the provider RETURNS.
 */
let eventRow: Record<string, unknown> | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventRow, error: null }) }) }) }),
  }),
}));

import { GET } from '@/app/api/events/[id]/forecast/route';
import { eventDateRange, isCalendarDate, parseOpenMeteo, raceDayOf } from '@/lib/events/forecast';
import { FRESH_MS, STALE_MAX_ENTRIES, STALE_MAX_MS, forecastCacheSize, rememberForecast, resetForecastCache, venueKey } from '@/lib/events/forecast-cache';

const call = (id = 'e1') => GET(new Request(`http://x/api/events/${id}/forecast`), { params: Promise.resolve({ id }) });
const fetchMock = vi.fn();
const VALENCIA = { lat: 39.4699, lng: -0.3763 };
const race = (date = '2026-12-06', end: string | null = null) => ({ id: 'e1', date, end_date: end, ...VALENCIA });

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** What Open-Meteo returns for forecast_days=16 starting at the venue's `from` date. */
function payload(from: string, opts: { days?: number; omitWind?: boolean } = {}) {
  const n = opts.days ?? 16;
  const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
  const hours = dates.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
  return {
    timezone: 'Europe/Madrid', utc_offset_seconds: 3600,
    current: { time: `${from}T10:15`, temperature_2m: 17.2, apparent_temperature: 16.1, precipitation: 0, wind_speed_10m: 9.4, weather_code: 1 },
    daily: {
      time: dates,
      temperature_2m_max: dates.map(() => 18), temperature_2m_min: dates.map(() => 9),
      precipitation_probability_max: dates.map(() => 20),
      wind_speed_10m_max: opts.omitWind ? undefined : dates.map(() => 15),
      weather_code: dates.map(() => 3),
    },
    hourly: { time: hours, temperature_2m: hours.map(() => 12), precipitation_probability: hours.map(() => 10),
      wind_speed_10m: hours.map(() => 8), weather_code: hours.map(() => 2) },
  };
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  fetchMock.mockReset();
  resetForecastCache();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('request', () => {
  it('asks for 16 days in the venue timezone, with current/daily/hourly — no start/end dates from our clock', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    await call();
    const u = new URL(fetchMock.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('forecast_days')).toBe('16');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('start_date')).toBeNull();
    expect(u.searchParams.get('end_date')).toBeNull();
    for (const k of ['current', 'daily', 'hourly']) expect(u.searchParams.get(k)).toBeTruthy();
  });
});

describe('Valencia, race Sunday 2026-12-06', () => {
  it('on Nov 20 the window is Nov 20 – Dec 5: current + near-term shown, race day explicitly out of range', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    const res = await call();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({
      provider: 'open-meteo', attribution: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
      eventId: 'e1', location: VALENCIA, timezone: 'Europe/Madrid', stale: false,
      validFrom: '2026-11-20', validThrough: '2026-12-05',
      raceDate: '2026-12-06', raceDates: ['2026-12-06'], raceDayStatus: 'out_of_range', raceDayReason: 'after_horizon',
      raceHourly: [], unavailableReason: null, fetchedAt: '2026-11-20T10:00:00.000Z',
    });
    expect(b.daily).toHaveLength(16);
    expect(b.current).toMatchObject({ temperatureC: 17.2, windKmh: 9.4 });
  });
  it('on Nov 21 the window reaches Dec 6: race day available, with its venue-local hours (incl. 08:00 for an 08:15 start)', async () => {
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-21')));
    const b = await (await call()).json();
    expect(b).toMatchObject({ validThrough: '2026-12-06', raceDayStatus: 'available', raceDayReason: null });
    expect(b.raceHourly).toHaveLength(24);
    expect(b.raceHourly.find((h: { time: string }) => h.time === '2026-12-06T08:00')).toBeTruthy();
  });
  it('venue today, not server today: at 23:30 UTC Nov 20 (00:30 Nov 21 in Madrid) the provider\'s window decides', async () => {
    vi.setSystemTime(new Date('2026-11-20T23:30:00Z'));
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-21')));
    expect((await (await call()).json()).raceDayStatus).toBe('available');
  });
  it('a multi-day event straddling the window end is partial', async () => {
    eventRow = race('2026-12-05', '2026-12-07');
    fetchMock.mockResolvedValue(ok(payload('2026-11-21')));
    expect(await (await call()).json()).toMatchObject({ raceDayStatus: 'partial', raceDayReason: 'after_horizon', raceDates: ['2026-12-05', '2026-12-06', '2026-12-07'] });
  });
  it('a race before the window is out_of_range / before_horizon, and current weather is still shown', async () => {
    eventRow = race('2026-11-01');
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    const b = await (await call()).json();
    expect(b).toMatchObject({ raceDayStatus: 'out_of_range', raceDayReason: 'before_horizon' });
    expect(b.current).not.toBeNull();
  });
  it('unknown stays null, never 0', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-20', { omitWind: true })));
    const b = await (await call()).json();
    expect(b.daily[0].windMaxKmh).toBeNull();
    expect(b.daily[0].tMaxC).toBe(18);
  });
});

describe('no location / unknown event', () => {
  it('404 only for an unknown event', async () => {
    eventRow = null;
    expect((await call()).status).toBe(404);
  });
  it('no coordinates → 200 DTO, unavailable/no_location, no fetch', async () => {
    eventRow = { id: 'e1', date: '2026-12-06', end_date: null, lat: null, lng: null };
    const b = await (await call()).json();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(b).toMatchObject({ location: null, raceDayStatus: 'unavailable', unavailableReason: 'no_location', current: null, daily: [] });
  });
});

describe('failures: stale if we have it, an explicit unavailable if not', () => {
  it.each([
    ['provider error', () => ({ ok: false, status: 500, json: async () => ({ reason: 'secret upstream' }) }), 'provider_error'],
    ['rate limited', () => ({ ok: false, status: 429, json: async () => ({}) }), 'rate_limited'],
  ])('%s with no cache → 200 unavailable, no-store, no upstream text', async (_n, res, reason) => {
    eventRow = race();
    fetchMock.mockResolvedValue(res());
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const b = await r.json();
    expect(b).toMatchObject({ unavailableReason: reason, stale: false, current: null, daily: [], raceDayStatus: 'unavailable', fetchedAt: null });
    expect(JSON.stringify(b)).not.toContain('secret upstream');
  });
  it('a timeout is reported as timeout', async () => {
    eventRow = race();
    fetchMock.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    expect((await (await call()).json()).unavailableReason).toBe('timeout');
  });
  it('429 after a good answer (older than fresh, within 6 h) → the last good copy, stale:true, no-store', async () => {
    eventRow = race();
    fetchMock.mockResolvedValueOnce(ok(payload('2026-11-20')));
    await call();
    vi.setSystemTime(new Date(Date.now() + FRESH_MS + 1));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    const r = await call();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ stale: true, unavailableReason: null, fetchedAt: '2026-11-20T10:00:00.000Z', validThrough: '2026-12-05' });
  });
  it('older than 6 h → unavailable, never old weather forever', async () => {
    eventRow = race();
    fetchMock.mockResolvedValueOnce(ok(payload('2026-11-20')));
    await call();
    vi.setSystemTime(new Date(Date.now() + STALE_MAX_MS + 1));
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await (await call()).json()).toMatchObject({ stale: false, unavailableReason: 'provider_error', daily: [] });
  });
});

describe('cache', () => {
  it('within 30 min the venue is not asked again; after, it is', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    await call(); await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.now() + FRESH_MS + 1));
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('concurrent requests for one venue share one provider request; two events at one venue share it too', async () => {
    eventRow = race();
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise((r) => { release = () => r(ok(payload('2026-11-20'))); }));
    const a = call('e1'); const b = call('e2');
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await ra.json()).validThrough).toBe('2026-12-05');
    expect((await rb.json()).eventId).toBe('e2');
  });
  it('venues never share an answer: two venues in flight at once → two requests, each its own payload', async () => {
    const rows: Record<string, Record<string, unknown>> = {
      a: { id: 'a', date: '2026-12-06', end_date: null, ...VALENCIA },
      b: { id: 'b', date: '2026-12-06', end_date: null, lat: 32.0853, lng: 34.7818 },
    };
    const releases: Array<() => void> = [];
    fetchMock.mockImplementation((url: string) => new Promise((r) => {
      const lat = new URL(url).searchParams.get('latitude');
      releases.push(() => r(ok({ ...payload('2026-11-20'), timezone: lat === '39.4699' ? 'Europe/Madrid' : 'Asia/Jerusalem' })));
    }));
    eventRow = rows.a; const pa = call('a');
    await new Promise((r) => setTimeout(r, 0));
    eventRow = rows.b; const pb = call('b');
    await new Promise((r) => setTimeout(r, 0));
    releases.forEach((f) => f());
    const [ba, bb] = await Promise.all([pa, pb].map(async (p) => (await p).json()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ba.timezone).toBe('Europe/Madrid');
    expect(bb.timezone).toBe('Asia/Jerusalem');
  });
  it('the venue key is the coordinates to 4 decimals (~11 m): a 5th-decimal difference shares, a 4th does not', () => {
    expect(venueKey(39.46991, -0.37631)).toBe(venueKey(39.46994, -0.37634));
    expect(venueKey(39.4699, -0.3763)).not.toBe(venueKey(39.4700, -0.3763));
  });
  it('is bounded', () => {
    for (let i = 0; i < STALE_MAX_ENTRIES + 50; i++) rememberForecast(`k${i}`, parseOpenMeteo({}));
    expect(forecastCacheSize()).toBe(STALE_MAX_ENTRIES);
  });
});

describe('v1 compatibility (docs/contracts/valencia.md parsers keep working)', () => {
  it('v1 fields: status ok + one day per race date, with the v1 per-day statuses', async () => {
    eventRow = race('2026-12-05', '2026-12-07');
    fetchMock.mockResolvedValue(ok(payload('2026-11-21')));
    const b = await (await call()).json();
    expect(b.version).toBe(2);
    expect(b.status).toBe('ok');
    expect(b.days).toEqual([
      { date: '2026-12-05', status: 'available', tMaxC: 18, tMinC: 9, precipProbPct: 20, windMaxKmh: 15, weatherCode: 3 },
      { date: '2026-12-06', status: 'available', tMaxC: 18, tMinC: 9, precipProbPct: 20, windMaxKmh: 15, weatherCode: 3 },
      { date: '2026-12-07', status: 'not_yet_available' },
    ]);
  });
  it('v1: a past race → past; no coordinates → status no_location, days []', async () => {
    eventRow = race('2026-11-01');
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    expect((await (await call()).json()).days).toEqual([{ date: '2026-11-01', status: 'past' }]);
    eventRow = { id: 'e1', date: '2026-12-06', end_date: null, lat: null, lng: null };
    expect(await (await call()).json()).toMatchObject({ status: 'no_location', days: [] });
  });
  it('v1: provider down with no cache → 200, status ok, every day error (was 502 in v1)', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'ok', days: [{ date: '2026-12-06', status: 'error' }] });
  });
});

describe('review 17:39: weather correctness', () => {
  const nullDay = (p: ReturnType<typeof payload>, date: string) => {
    const i = p.daily.time.indexOf(date);
    for (const k of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'wind_speed_10m_max', 'weather_code'] as const) {
      if (p.daily[k]) (p.daily[k] as (number | null)[])[i] = null;
    }
    return p;
  };
  it('a race date present with every field null is NOT available: unavailable / no_data, v1 day error', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok(nullDay(payload('2026-11-21'), '2026-12-06')));
    const b = await (await call()).json();
    expect(b).toMatchObject({ raceDayStatus: 'unavailable', raceDayReason: 'no_data' });
    expect(b.days).toEqual([{ date: '2026-12-06', status: 'error' }]);
  });
  it('a multi-day race with one null-only day is partial / no_data', async () => {
    eventRow = race('2026-12-05', '2026-12-06');
    fetchMock.mockResolvedValue(ok(nullDay(payload('2026-11-21'), '2026-12-06')));
    expect(await (await call()).json()).toMatchObject({ raceDayStatus: 'partial', raceDayReason: 'no_data' });
  });
  it('an empty / junk 200 with no cache → unavailable invalid_payload, nothing cached', async () => {
    eventRow = race();
    for (const junk of [{}, { daily: { time: [] } }, { daily: { time: ['2026-11-20'] } }]) {
      resetForecastCache();
      fetchMock.mockResolvedValueOnce(ok(junk));
      const r = await call();
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toMatchObject({ unavailableReason: 'invalid_payload', stale: false, daily: [] });
      expect(forecastCacheSize()).toBe(0);
    }
  });
  it('a junk 200 never overwrites the last good answer: stale good weather is served, and still is next time', async () => {
    eventRow = race();
    fetchMock.mockResolvedValueOnce(ok(payload('2026-11-20')));
    await call();
    vi.setSystemTime(new Date(Date.now() + FRESH_MS + 1));
    fetchMock.mockResolvedValueOnce(ok({}));
    expect(await (await call()).json()).toMatchObject({ stale: true, validThrough: '2026-12-05', unavailableReason: null });
    fetchMock.mockResolvedValueOnce(ok({ daily: { time: [] } }));
    const again = await (await call()).json();
    expect(again).toMatchObject({ stale: true, validThrough: '2026-12-05' });
    expect(again.daily).toHaveLength(16);
  });
  it.each([['missing', undefined], ['malformed', 'not a zone!'], ['number', 3600]])(
    'timezone %s → null, never a default zone', async (_n, value) => {
      eventRow = race();
      const p: Record<string, unknown> = { ...payload('2026-11-20') };
      if (value === undefined) delete p.timezone; else p.timezone = value;
      fetchMock.mockResolvedValue(ok(p));
      expect((await (await call()).json()).timezone).toBeNull();
    });
  it.each([[95, 0], [-91, 0], [0, 181], [0, -180.5]])('coordinates out of bounds (%d, %d) → no_location, no request', async (lat, lng) => {
    eventRow = { id: 'e1', date: '2026-12-06', end_date: null, lat, lng };
    expect(await (await call()).json()).toMatchObject({ unavailableReason: 'no_location', location: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('downstream max-age is what is left of freshness: 1800 when just fetched, 180 when served 27 min later', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    expect((await call()).headers.get('cache-control')).toBe('public, max-age=1800');
    vi.setSystemTime(new Date(Date.now() + 27 * 60_000));
    const r = await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.headers.get('cache-control')).toBe('public, max-age=180');
  });
});

describe('review 17:56: zone and date hardening', () => {
  it.each([['Fake/Zone'], ['Mars/Olympus'], ['Europe/Nowhere']])('a zone-shaped but unknown timezone (%s) → null', async (zone) => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok({ ...payload('2026-11-20'), timezone: zone }));
    expect((await (await call()).json()).timezone).toBeNull();
  });
  it.each([['Europe/Madrid'], ['UTC']])('a real zone (%s) is kept as given', async (zone) => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok({ ...payload('2026-11-20'), timezone: zone }));
    expect((await (await call()).json()).timezone).toBe(zone);
  });
  it('an impossible event date (2026-99-99) does not crash: 200, no race dates, current weather still shown', async () => {
    eventRow = { id: 'e1', date: '2026-99-99', end_date: '2026-99-99', ...VALENCIA };
    fetchMock.mockResolvedValue(ok(payload('2026-11-20')));
    const r = await call();
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ raceDates: [], raceDate: '', raceDayStatus: 'unavailable', days: [] });
    expect(b.current).not.toBeNull();
  });
  it('an impossible end date keeps the start date only', () => {
    expect(eventDateRange('2026-12-06', '2026-02-30')).toEqual(['2026-12-06']);
    expect(eventDateRange('2026-02-30', '2026-12-06')).toEqual([]);
  });
  it('isCalendarDate: real days only', () => {
    for (const ok_ of ['2026-12-06', '2028-02-29']) expect(isCalendarDate(ok_)).toBe(true);
    for (const bad of ['2026-99-99', '2026-02-30', '2027-02-29', '2026-12-6', '', null, 20261206]) expect(isCalendarDate(bad)).toBe(false);
  });
  it('provider dates that are not calendar days are dropped, never crash', () => {
    const p = payload('2026-11-20', { days: 2 });
    p.daily.time = ['2026-02-30', '2026-11-21'];
    p.hourly.time = ['2026-99-99T08:00', '2026-11-21T08:00'];
    const f = parseOpenMeteo(p);
    expect(f.daily.map((d) => d.date)).toEqual(['2026-11-21']);
    expect(f.hourly.map((h) => h.time)).toEqual(['2026-11-21T08:00']);
  });
  it('a current-only payload with every field null is junk: invalid_payload, nothing cached', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok({ timezone: 'Europe/Madrid', current: { time: '2026-11-20T11:00', temperature_2m: null,
      apparent_temperature: null, precipitation: null, wind_speed_10m: null, weather_code: null } }));
    expect(await (await call()).json()).toMatchObject({ unavailableReason: 'invalid_payload', current: null });
    expect(forecastCacheSize()).toBe(0);
  });
  it('a current-only payload with real values is usable and cached (near-term weather without days)', async () => {
    eventRow = race();
    fetchMock.mockResolvedValue(ok({ timezone: 'Europe/Madrid', current: { time: '2026-11-20T11:00', temperature_2m: 16 } }));
    const b = await (await call()).json();
    expect(b).toMatchObject({ unavailableReason: null, current: { temperatureC: 16, windKmh: null }, daily: [], raceDayStatus: 'unavailable' });
    expect(forecastCacheSize()).toBe(1);
  });
});

describe('pure helpers', () => {
  it('eventDateRange is inclusive and capped', () => {
    expect(eventDateRange('2026-12-05', '2026-12-07')).toEqual(['2026-12-05', '2026-12-06', '2026-12-07']);
    expect(eventDateRange('2026-12-06', null)).toEqual(['2026-12-06']);
  });
  it('raceDayOf: a date inside the window the provider omitted is unavailable, not available', () => {
    const f = parseOpenMeteo(payload('2026-11-21'));
    f.daily = f.daily.filter((d) => d.date !== '2026-11-30');
    expect(raceDayOf(['2026-11-30'], f)).toEqual({ status: 'unavailable', reason: null });
  });
  it('parseOpenMeteo on junk: empty window, nulls', () => {
    expect(parseOpenMeteo(null)).toEqual({ timezone: null, utcOffsetSec: null, validFrom: null, validThrough: null, current: null, daily: [], hourly: [] });
  });
});
