import { describe, expect, it } from 'vitest';
import { missingDetails, remainingSteps, type SetupFacts } from '@/lib/setup/gate';

/** The required setup (2026-10-20): install, watch, push, then only the missing details. */
const all: SetupFacts = { installed: true, phone: true, strava: true, garmin: true, noWatch: false, push: true, birthDate: '1990-03-14', heightCm: 178, sizes: ['M', 'M', 'S', '39-42', '43'] };

describe('what is left', () => {
  it('nothing, when everything is done', () => expect(remainingSteps(all)).toEqual([]));
  it('in order: install, watch, push, details', () => {
    expect(remainingSteps({ ...all, installed: false, garmin: false, push: false, heightCm: null })).toEqual(['install', 'watch', 'push', 'details']);
  });
  it('"I have no Garmin" passes the watch step', () => expect(remainingSteps({ ...all, garmin: false, noWatch: true })).toEqual([]));
  it('Strava from the sign-in does not pass it — the step is Garmin', () => {
    expect(remainingSteps({ ...all, garmin: false, strava: true })).toEqual(['watch']);
  });
  it('a computer has nothing to install and no push to grant', () => {
    expect(remainingSteps({ ...all, phone: false, installed: false, push: false })).toEqual([]);
  });
  it('details: only what is missing; weight is never asked for', () => {
    expect(missingDetails({ birthDate: '1990-03-14', heightCm: null, sizes: ['M', null, 'S', 'M', '43'] })).toEqual({ birthDate: false, height: true, sizes: true });
    expect(remainingSteps({ ...all, sizes: ['M', 'M', 'S', '39-42', null] })).toEqual(['details']);
  });
});
