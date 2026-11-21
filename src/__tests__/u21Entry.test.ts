import { describe, expect, it } from 'vitest';
import { parseU21TrackParam, u21EntryHref } from '@/lib/u21/entry';
import { U21_TRACKS } from '@/lib/u21/intake';

describe('u21EntryHref', () => {
  it('builds a /u21 deep link per track', () => {
    expect(u21EntryHref('basic')).toBe('/u21?track=basic');
    expect(u21EntryHref('advanced')).toBe('/u21?track=advanced');
    expect(u21EntryHref('pro')).toBe('/u21?track=pro');
  });

  it('covers every declared track exactly once', () => {
    expect(U21_TRACKS.map(t => t.id).sort()).toEqual(['advanced', 'basic', 'pro']);
  });
});

describe('parseU21TrackParam', () => {
  it('accepts exact track ids', () => {
    expect(parseU21TrackParam('basic')).toBe('basic');
    expect(parseU21TrackParam('advanced')).toBe('advanced');
    expect(parseU21TrackParam('pro')).toBe('pro');
  });

  it('rejects anything else, so a bad link falls back to the track picker', () => {
    expect(parseU21TrackParam('')).toBeNull();
    expect(parseU21TrackParam('BASIC')).toBeNull();
    expect(parseU21TrackParam(' basic')).toBeNull();
    expect(parseU21TrackParam('basic ')).toBeNull();
    expect(parseU21TrackParam('elite')).toBeNull();
    expect(parseU21TrackParam('<script>')).toBeNull();
    expect(parseU21TrackParam(null)).toBeNull();
    expect(parseU21TrackParam(undefined)).toBeNull();
  });

  it('round-trips every declared track', () => {
    for (const t of U21_TRACKS) {
      const q = new URLSearchParams(u21EntryHref(t.id).split('?')[1]);
      expect(parseU21TrackParam(q.get('track'))).toBe(t.id);
    }
  });
});
