import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The trainee-experience v2 switch (lib/trainee/v2.ts): off for everyone until Ofer flips
 * TRAINEE_V2_FOR_ALL; `?tv=2` turns it on for one device and is remembered; `?tv=off`
 * turns it back off.
 */

vi.mock('@/lib/impersonation', () => ({ useIsSuperUser: () => false }));
const { TRAINEE_V2_FOR_ALL, TRAINEE_V2_KEY, previewTraineeV2 } = await import('@/lib/trainee/v2');

function device(search: string, stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  vi.stubGlobal('window', { location: { search } });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the trainee v2 switch', () => {
  it('ships off', () => {
    expect(TRAINEE_V2_FOR_ALL).toBe(false);
  });

  it('?tv=2 turns it on and is remembered on the device', () => {
    const store = device('?tv=2');
    expect(previewTraineeV2()).toBe(true);
    expect(store.get(TRAINEE_V2_KEY)).toBe('1');
    device('', Object.fromEntries(store));
    expect(previewTraineeV2()).toBe(true);
  });

  it('?tv=off turns it off; nothing at all is off', () => {
    expect((device('?tv=off', { [TRAINEE_V2_KEY]: '1' }), previewTraineeV2())).toBe(false);
    expect((device(''), previewTraineeV2())).toBe(false);
  });
});
