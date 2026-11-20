import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let eventRow: Record<string, unknown> | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventRow, error: null }) }) }),
    }),
  }),
}));

import { GET } from '@/app/api/events/[id]/forecast/route';
import { classifyDate, eventDateRange, mapOpenMeteoDaily } from '@/lib/events/forecast';

const call = () => GET(new Request('http://x/api/events/e1/forecast'), { params: Promise.resolve({ id: 'e1' }) });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('forecast helpers', () => {
  it('builds inclusive ranges', () => {
    expect(eventDateRange('2026-11-21', '2026-11-23')).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
    expect(eventDateRange('2026-11-21', null)).toEqual(['2026-11-21']);
    expect(eventDateRange('2026-11-21', '2026-11-20')).toEqual(['2026-11-21']);
  });
  it('classifies the 16-day horizon', () => {
    expect(classifyDate('2026-11-19', '2026-11-20')).toBe('past');
    expect(classifyDate('2026-11-20', '2026-11-20')).toBe('in_range');
    expect(classifyDate('2026-12-05', '2026-11-20')).toBe('in_range');
    expect(classifyDate('2026-12-06', '2026-11-20')).toBe('not_yet_available');
  });
  it('marks dates missing from the payload as error', () => {
    expect(mapOpenMeteoDaily({ daily: { time: [] } }, ['2026-11-21'])).toEqual([{ date: '2026-11-21', status: 'error' }]);
  });
});

describe('GET /api/events/[id]/forecast', () => {
  it('404s for a missing event', async () => {
    eventRow = null;
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Event not found' });
  });

  it('returns no_location without coordinates', async () => {
    eventRow = { id: 'e1', date: '2026-11-22', end_date: null, lat: null, lng: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'no_location', eventId: 'e1', days: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch when every date is beyond the horizon', async () => {
    eventRow = { id: 'e1', date: '2027-01-10', end_date: '2027-01-11', lat: 32.1, lng: 34.8 };
    const res = await call();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=1800');
    expect((await res.json()).days).toEqual([
      { date: '2027-01-10', status: 'not_yet_available' },
      { date: '2027-01-11', status: 'not_yet_available' },
    ]);
  });

  it('marks past dates without fetching', async () => {
    eventRow = { id: 'e1', date: '2026-11-01', end_date: null, lat: 32.1, lng: 34.8 };
    const body = await (await call()).json();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body).toEqual({ status: 'ok', eventId: 'e1', days: [{ date: '2026-11-01', status: 'past' }] });
  });

  it('maps in-range days', async () => {
    eventRow = { id: 'e1', date: '2026-11-22', end_date: null, lat: 32.1, lng: 34.8 };
    fetchMock.mockResolvedValue(okJson({ daily: {
      time: ['2026-11-22'], temperature_2m_max: [24.1], temperature_2m_min: [15.2],
      precipitation_probability_max: [10], wind_speed_10m_max: [18.4], weather_code: [2],
    } }));
    const body = await (await call()).json();
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('start_date')).toBe('2026-11-22');
    expect(url.searchParams.get('end_date')).toBe('2026-11-22');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(body.days).toEqual([{ date: '2026-11-22', status: 'available', tMaxC: 24.1, tMinC: 15.2, precipProbPct: 10, windMaxKmh: 18.4, weatherCode: 2 }]);
  });

  it('handles a range straddling the horizon', async () => {
    eventRow = { id: 'e1', date: '2026-12-05', end_date: '2026-12-07', lat: 32.1, lng: 34.8 };
    fetchMock.mockResolvedValue(okJson({ daily: {
      time: ['2026-12-05'], temperature_2m_max: [20], temperature_2m_min: [12],
      precipitation_probability_max: [55], wind_speed_10m_max: [30], weather_code: [61],
    } }));
    const body = await (await call()).json();
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('end_date')).toBe('2026-12-05');
    expect(body.days.map((d: { status: string }) => d.status)).toEqual(['available', 'not_yet_available', 'not_yet_available']);
  });

  it('502s on fetch failure without leaking upstream text', async () => {
    eventRow = { id: 'e1', date: '2026-11-22', end_date: null, lat: 32.1, lng: 34.8 };
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ reason: 'secret upstream' }) });
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Forecast unavailable' });
  });

  it('502s when fetch rejects', async () => {
    eventRow = { id: 'e1', date: '2026-11-22', end_date: null, lat: 32.1, lng: 34.8 };
    fetchMock.mockRejectedValue(new Error('network down'));
    expect((await call()).status).toBe(502);
  });
});
