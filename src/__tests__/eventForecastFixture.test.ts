import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildDTO, parseOpenMeteo } from '@/lib/events/forecast';

/**
 * docs/contracts/fixtures/event-forecast.v2.example.json — the exact v2 body for a Valencia-shaped event
 * on 2026-11-20 (race 2026-12-06 out of range). SYNTHETIC weather numbers. Fails if the shape drifts
 * (regenerate with UPDATE_FIXTURE=1).
 */
const FILE = join(process.cwd(), 'docs/contracts/fixtures/event-forecast.v2.example.json');
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dates = Array.from({ length: 16 }, (_, i) => addDays('2026-11-20', i));
const provider = {
  timezone: 'Europe/Madrid', utc_offset_seconds: 3600,
  current: { time: '2026-11-20T11:00', temperature_2m: 17.2, apparent_temperature: 16.1, precipitation: 0, wind_speed_10m: 9.4, weather_code: 1 },
  daily: { time: dates, temperature_2m_max: dates.map((_, i) => 18 - (i % 3)), temperature_2m_min: dates.map(() => 9),
    precipitation_probability_max: dates.map((_, i) => (i === 4 ? null : 20)), wind_speed_10m_max: dates.map(() => 15), weather_code: dates.map(() => 3) },
  hourly: { time: [], temperature_2m: [], precipitation_probability: [], wind_speed_10m: [], weather_code: [] },
};

describe('event forecast v2 example payload', () => {
  it('matches the fixture file', () => {
    const dto = buildDTO({ eventId: '00000000-0000-4000-8000-00000000e001', lat: 39.4699, lng: -0.3763,
      raceDates: ['2026-12-06'], forecast: parseOpenMeteo(provider), fetchedAt: Date.parse('2026-11-20T10:00:00Z'),
      stale: false, unavailableReason: null });
    const json = JSON.stringify({ _note: 'Synthetic weather. GET /api/events/:id/forecast v2 on 2026-11-20 for a race on 2026-12-06 (out of range). daily[4].precipProbPct null = provider did not report it.', ...dto }, null, 2) + '\n';
    if (process.env.UPDATE_FIXTURE === '1' || !existsSync(FILE)) writeFileSync(FILE, json);
    expect(readFileSync(FILE, 'utf8')).toBe(json);
  });
});
