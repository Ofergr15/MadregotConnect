import { describe, expect, it } from 'vitest';
import {
  ageOnDay,
  estimatedMaxHR,
  getHRZone,
  resolveRunTypeBadge,
  DEFAULT_MAX_HR,
} from '@/components/activity/format';

describe('ageOnDay', () => {
  it('counts whole years and waits for the birthday', () => {
    expect(ageOnDay('1990-09-05', '2026-09-05')).toBe(36);
    expect(ageOnDay('1990-09-06', '2026-09-05')).toBe(35);
    expect(ageOnDay('1990-01-01', '2026-12-31')).toBe(36);
    expect(ageOnDay('1990-12-31', '2026-01-01')).toBe(35);
  });

  it('tolerates a full timestamp on either side', () => {
    expect(ageOnDay('1990-09-05T00:00:00.000Z', '2026-09-05T07:50:00')).toBe(36);
  });

  it('rejects an age no club member has', () => {
    expect(ageOnDay('2026-09-05', '2026-09-05')).toBeNull();
    expect(ageOnDay('1850-01-01', '2026-09-05')).toBeNull();
    expect(ageOnDay('not-a-date', '2026-09-05')).toBeNull();
  });
});

describe('estimatedMaxHR', () => {
  it('is 220 minus age', () => {
    expect(estimatedMaxHR('1990-09-05', '2026-09-05')).toBe(184);
    expect(estimatedMaxHR('1971-03-01', '2026-09-05')).toBe(165);
  });

  it('falls back to 190 with no usable birth date, which is most of the roster', () => {
    expect(estimatedMaxHR(null, '2026-09-05')).toBe(DEFAULT_MAX_HR);
    expect(estimatedMaxHR('', '2026-09-05')).toBe(DEFAULT_MAX_HR);
    expect(estimatedMaxHR('garbage', '2026-09-05')).toBe(DEFAULT_MAX_HR);
  });

  it('is the fix a 55-year-old needed: 130 bpm is zone 3 for them, not zone 2', () => {
    const birthDate = '1971-03-01';
    expect(getHRZone(130).zone).toBe(2);
    expect(getHRZone(130, estimatedMaxHR(birthDate, '2026-09-05')).zone).toBe(3);
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
});
