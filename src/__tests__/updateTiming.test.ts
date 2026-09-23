import { describe, it, expect } from 'vitest';
import { AWAY_MS, START_WINDOW_MS, canApplyUpdate } from '@/lib/update-timing';

const at = (m: Partial<Parameters<typeof canApplyUpdate>[0]>) =>
  canApplyUpdate({ sinceLoadMs: 60_000, interacted: true, visible: true, awayMs: 0, ...m });

describe('canApplyUpdate', () => {
  it('applies right after launch, before anyone touches the app', () => {
    expect(at({ sinceLoadMs: 2_000, interacted: false })).toBe(true);
  });

  it('never reloads under someone who is using the app', () => {
    expect(at({ sinceLoadMs: 2_000, interacted: true })).toBe(false);
    expect(at({})).toBe(false);
  });

  it('a launch that sat untouched past the start window is not a start any more', () => {
    expect(at({ sinceLoadMs: START_WINDOW_MS + 1, interacted: false })).toBe(false);
  });

  it('applies on coming back after being away long enough, not after a quick switch', () => {
    expect(at({ awayMs: AWAY_MS })).toBe(true);
    expect(at({ awayMs: 60_000 })).toBe(false);
  });

  it('does nothing while hidden', () => {
    expect(at({ visible: false, sinceLoadMs: 1_000, interacted: false })).toBe(false);
  });
});
