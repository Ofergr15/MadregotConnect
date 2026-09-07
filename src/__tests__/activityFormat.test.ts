import { describe, expect, it } from 'vitest';
import {
  getHRZone,
  resolveRunTypeBadge,
  DEFAULT_MAX_HR,
} from '@/components/activity/format';
import he from '../../messages/he.json';
import en from '../../messages/en.json';

describe('getHRZone', () => {
  // One ceiling for the whole club, on purpose: an age-derived 220 − age version
  // was built and then removed, because rendering a card should not require
  // reading the athlete's birth date.
  it('splits the zones at 60/70/80/90% of the ceiling', () => {
    expect(DEFAULT_MAX_HR).toBe(190);
    expect(getHRZone(100).zone).toBe(1); // 53%
    expect(getHRZone(120).zone).toBe(2); // 63%
    expect(getHRZone(140).zone).toBe(3); // 74%
    expect(getHRZone(160).zone).toBe(4); // 84%
    expect(getHRZone(180).zone).toBe(5); // 95%
  });

  it('scales when the caller raises the ceiling to what the run recorded', () => {
    // 180 bpm is zone 5 against 190 and only zone 4 for someone who has been
    // measured at 205 — which is what the callers pass.
    expect(getHRZone(180, 205).zone).toBe(4);
  });
});

describe('resolveRunTypeBadge', () => {
  it('uses the sport the provider named over any guess', () => {
    // 6 km at 4:15/km on a trail: the heuristic called this "Intervals".
    expect(resolveRunTypeBadge('trail_running', 6, 255).type).toBe('trail_running');
    // 10 km at 4:20/km indoors: the heuristic called this "Tempo".
    expect(resolveRunTypeBadge('treadmill_running', 10, 260).type).toBe('treadmill_running');
    expect(resolveRunTypeBadge('indoor_running', 10, 260).label).toBe('Treadmill');
    expect(resolveRunTypeBadge('track_running', 8, 250).label).toBe('Track');
  });

  it('still guesses for a plain road run, where nothing else is known', () => {
    expect(resolveRunTypeBadge('running', 20, 330).type).toBe('long_run');
    expect(resolveRunTypeBadge('running', 10, 260).type).toBe('tempo');
    expect(resolveRunTypeBadge(null, 5, 400).type).toBe('recovery');
    expect(resolveRunTypeBadge(undefined, 8, 320).type).toBe('easy');
  });

  // The feed renders the badge as t(`runType_${type}`), and next-intl prints the
  // key itself when it is missing — so every sport added here has to be added to
  // both locale files in the same change. The four sport badges shipped without
  // their keys, and "activities.runType_treadmill_running" showed up in the feed
  // as a 180px-wide label that pushed the whole row off a 402px screen. The
  // locale-parity test could not catch it: both files were missing it equally.
  it('has a translation for every badge type it can return, in both locales', () => {
    const sports = ['trail_running', 'treadmill_running', 'indoor_running', 'track_running', 'virtual_run'];
    const guessed = [
      resolveRunTypeBadge('running', 20, 330),
      resolveRunTypeBadge('running', 10, 260),
      resolveRunTypeBadge('running', 8, 280),
      resolveRunTypeBadge(null, 5, 400),
      resolveRunTypeBadge(undefined, 8, 320),
    ];
    const types = new Set([
      ...sports.map((s) => resolveRunTypeBadge(s, 10, 260).type),
      ...guessed.map((b) => b.type),
    ]);
    for (const [name, messages] of [['he', he], ['en', en]] as const) {
      for (const type of types) {
        expect(Object.keys(messages.activities), `${name}: runType_${type}`).toContain(`runType_${type}`);
      }
    }
  });
});
