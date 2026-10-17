import { describe, expect, it } from 'vitest';
import { displayRunName } from '@/lib/activities/run-name';

// start_time holds the athlete's own wall clock as UTC (see parseActivityInstant).
const MORNING = '2026-10-16T05:25:34+00:00'; // 05:25
const NOON = '2026-10-17T12:08:21+00:00'; // 12:08

describe('displayRunName', () => {
  it('turns the bare sport name into the time of day', () => {
    expect(displayRunName('Running', MORNING, 'he')).toBe('ריצת בוקר');
    expect(displayRunName('ריצה', NOON, 'he')).toBe('ריצת צהריים');
    expect(displayRunName('', MORNING, 'en')).toBe('Morning Run');
  });
  it('translates the providers\' automatic names', () => {
    expect(displayRunName('Morning Run', MORNING, 'he')).toBe('ריצת בוקר');
    expect(displayRunName('Tel Aviv Running', MORNING, 'he')).toBe('Tel Aviv ריצה');
  });
  it('never touches a name the athlete typed', () => {
    expect(displayRunName('3x(5k/5k)', MORNING, 'he')).toBe('3x(5k/5k)');
    expect(displayRunName('שישי - ארוכה מיוחד', MORNING, 'he')).toBe('שישי - ארוכה מיוחד');
  });
});
