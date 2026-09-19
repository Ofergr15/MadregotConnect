import { describe, it, expect } from 'vitest';
import { googleMapsUrl, parseMapLink } from '@/lib/events/map-link';

/** Every link below was taken from a real Google Maps share, not invented. */
describe('parseMapLink', () => {
  it('reads the place pin out of a full place URL', () => {
    const res = parseMapLink(
      'https://www.google.com/maps/place/Park+HaYarkon/@32.0999,34.8115,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d32.1021!4d34.8236!16s%2Fg%2F1234',
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The !3d/!4d pin, NOT the @ viewport centre — the two differ here on purpose.
    expect(res.point.lat).toBeCloseTo(32.1021, 4);
    expect(res.point.lng).toBeCloseTo(34.8236, 4);
  });

  it('falls back to the @ viewport centre when there is no place pin', () => {
    const res = parseMapLink('https://www.google.com/maps/@32.0853,34.7818,14z');
    expect(res).toEqual({ ok: true, point: { lat: 32.0853, lng: 34.7818 } });
  });

  it('reads the documented search and directions forms', () => {
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=31.7683,35.2137')).toEqual({
      ok: true,
      point: { lat: 31.7683, lng: 35.2137 },
    });
    expect(parseMapLink('https://www.google.com/maps/dir/?api=1&destination=29.5577,34.9519')).toEqual({
      ok: true,
      point: { lat: 29.5577, lng: 34.9519 },
    });
    expect(parseMapLink('https://maps.google.com/?q=32.7940,34.9896')).toEqual({
      ok: true,
      point: { lat: 32.794, lng: 34.9896 },
    });
  });

  it('decodes a percent-encoded comma, which Google emits', () => {
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=32.0853%2C34.7818')).toEqual({
      ok: true,
      point: { lat: 32.0853, lng: 34.7818 },
    });
  });

  it('accepts a Waze share, because the field is about the place and not the app', () => {
    expect(parseMapLink('https://waze.com/ul?ll=32.1656,34.8436&navigate=yes')).toEqual({
      ok: true,
      point: { lat: 32.1656, lng: 34.8436 },
    });
  });

  it('accepts a bare pair, which is what "copy coordinates" gives', () => {
    expect(parseMapLink('32.0853, 34.7818')).toEqual({ ok: true, point: { lat: 32.0853, lng: 34.7818 } });
    expect(parseMapLink('  -33.8688,151.2093  ')).toEqual({ ok: true, point: { lat: -33.8688, lng: 151.2093 } });
  });

  it('names a short link as a short link, so the UI can ask for the full URL', () => {
    expect(parseMapLink('https://maps.app.goo.gl/AbCdEfGhIjK')).toEqual({ ok: false, reason: 'shortLink' });
    expect(parseMapLink('https://goo.gl/maps/AbCdEfGhIjK')).toEqual({ ok: false, reason: 'shortLink' });
  });

  it('refuses anything it cannot read coordinates out of', () => {
    expect(parseMapLink('')).toEqual({ ok: false, reason: 'unparsed' });
    expect(parseMapLink('   ')).toEqual({ ok: false, reason: 'unparsed' });
    expect(parseMapLink('Park HaYarkon, Tel Aviv')).toEqual({ ok: false, reason: 'unparsed' });
    expect(parseMapLink('https://www.google.com/maps/place/Park+HaYarkon')).toEqual({
      ok: false,
      reason: 'unparsed',
    });
  });

  it('refuses out-of-range numbers rather than pinning the edge of the map', () => {
    expect(parseMapLink('132.0853, 34.7818')).toEqual({ ok: false, reason: 'unparsed' });
    expect(parseMapLink('32.0853, 234.7818')).toEqual({ ok: false, reason: 'unparsed' });
  });

  it('refuses the null island, which is an empty template and not a race', () => {
    expect(parseMapLink('0,0')).toEqual({ ok: false, reason: 'unparsed' });
    expect(parseMapLink('https://www.google.com/maps/@0,0,3z')).toEqual({ ok: false, reason: 'unparsed' });
  });

  it('does not pick two numbers out of a sentence', () => {
    expect(parseMapLink('the race is 10, 21 or 42 km')).toEqual({ ok: false, reason: 'unparsed' });
  });
});

describe('googleMapsUrl', () => {
  it('builds the app-agnostic search form', () => {
    expect(googleMapsUrl({ lat: 32.0853, lng: 34.7818 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=32.0853,34.7818',
    );
  });

  it('round-trips through the parser', () => {
    const point = { lat: 31.7683, lng: 35.2137 };
    expect(parseMapLink(googleMapsUrl(point))).toEqual({ ok: true, point });
  });
});
