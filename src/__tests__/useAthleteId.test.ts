import { describe, expect, it, afterEach } from 'vitest';
import { readAthleteId } from '@/lib/use-athlete-id';

// The tests run in node, with no `window` — which is exactly the environment the
// contract below is about. `readAthleteId` is called from a render pass
// (`useState(readAthleteId)`), so it has to be total: anything it throws would
// take a whole screen down instead of just leaving the id unknown.

describe('readAthleteId', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it('returns an empty string with no window instead of throwing', () => {
    expect(readAthleteId()).toBe('');
  });

  it('reads the key when storage is there', () => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: { getItem: (k: string) => (k === 'athlete_id' ? 'abc-123' : null) },
    };
    // The module reads the global `localStorage`, which in a browser is the same
    // object — mirror it so this exercises the real path and not a shim.
    (globalThis as Record<string, unknown>).localStorage = (
      (globalThis as Record<string, any>).window as { localStorage: unknown }
    ).localStorage;
    expect(readAthleteId()).toBe('abc-123');
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('survives storage that throws (private mode)', () => {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).localStorage = {
      getItem() { throw new Error('SecurityError'); },
    };
    expect(readAthleteId()).toBe('');
    delete (globalThis as Record<string, unknown>).localStorage;
  });
});
