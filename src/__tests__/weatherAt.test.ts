import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { __resetWeatherCache, inRange, parseQuery, weatherAt } from '@/lib/weather/at';

const body = { hourly: { time: ['2026-11-22T18:00', '2026-11-22T19:00'], temperature_2m: [21.4, 20], apparent_temperature: [21, 19],
  relative_humidity_2m: [60, 65], precipitation_probability: [5, 10], wind_speed_10m: [9, 8], weather_code: [1, 2] } };

describe('weather at start time', () => {
  beforeEach(() => __resetWeatherCache());
  it('validates the query and rounds the place', () => {
    expect(parseQuery(new URLSearchParams('lat=32.0853&lon=34.7818&time=2026-11-22T18:30'))).toEqual({ lat: 32.09, lon: 34.78, date: '2026-11-22', hour: 18 });
    expect(parseQuery(new URLSearchParams('lon=34&time=2026-11-22T18:30'))).toBe('lat');
    expect(parseQuery(new URLSearchParams('lat=32&lon=34&time=tomorrow'))).toBe('time');
  });
  it('only answers inside the forecast range', () => {
    expect(inRange('2026-11-22', '2026-11-21')).toBe(true);
    expect(inRange('2026-11-20', '2026-11-21')).toBe(false);
    expect(inRange('2026-12-30', '2026-11-21')).toBe(false);
  });
  it('picks the start hour and caches per place+hour', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(body)));
    const a = await weatherAt(32.09, 34.78, '2026-11-22', 18, f as any, 0);
    const b = await weatherAt(32.09, 34.78, '2026-11-22', 18, f as any, 1000);
    expect(a).toMatchObject({ time: '2026-11-22T18:00', tempC: 21.4, precipProb: 5, code: 1 });
    expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('does not cache an upstream failure', async () => {
    const f = vi.fn(async () => new Response('x', { status: 503 }));
    expect(await weatherAt(32, 34, '2026-11-22', 18, f as any, 0)).toBeNull();
    expect(await weatherAt(32, 34, '2026-11-22', 18, f as any, 1)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('route is member-gated', () => {
    const route = readFileSync('src/app/api/weather/at/route.ts', 'utf8');
    expect(route).toMatch(/requireMember\(request\)/);
  });
});
