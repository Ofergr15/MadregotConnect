import { describe, expect, it } from 'vitest';
import { watchRange } from '@/lib/academy/watch-range';

/** The range on the watch (spec §3.8, mockup 4: 4:05 → 4:01–4:09). */

describe('watchRange', () => {
  it('work: ±1.5%, rounded to the second — 245 gives 241–249', () => {
    expect(watchRange({ targetPaceMinPerKm: 245 }, 'work')).toEqual({ min: 241, max: 249 });
    expect(watchRange({ targetPaceMinPerKm: 245, targetPaceMaxPerKm: 245 }, 'work')).toEqual({ min: 241, max: 249 });
  });

  it('easy: ±5% — 340 gives 323–357', () => {
    expect(watchRange({ targetPaceMinPerKm: 340 }, 'easy')).toEqual({ min: 323, max: 357 });
  });

  it('a stored real range wins, whichever way round it is stored', () => {
    expect(watchRange({ targetPaceMinPerKm: 240, targetPaceMaxPerKm: 250 }, 'work')).toEqual({ min: 240, max: 250 });
    expect(watchRange({ targetPaceMinPerKm: 250, targetPaceMaxPerKm: 240 }, 'easy')).toEqual({ min: 240, max: 250 });
  });

  it('only one side stored is a single pace', () => {
    expect(watchRange({ targetPaceMaxPerKm: 245 }, 'work')).toEqual({ min: 241, max: 249 });
  });

  it('no pace, no range', () => {
    expect(watchRange({}, 'work')).toBeNull();
  });
});
