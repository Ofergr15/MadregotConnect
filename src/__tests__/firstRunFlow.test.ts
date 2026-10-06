import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { permissionKind } from '@/components/install/IosPermissionPreview';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36';

describe('the permission popup is drawn in the phone\'s language', () => {
  it('an English iPhone gets "Allow", a Hebrew one "אפשר", Android its own dialog', () => {
    expect(permissionKind(IPHONE, ['en-US'])).toBe('ios-en');
    expect(permissionKind(IPHONE, ['he-IL', 'en-US'])).toBe('ios-he');
    expect(permissionKind(ANDROID, ['iw-IL'])).toBe('android-he');
    expect(permissionKind(ANDROID, ['en-GB'])).toBe('android-en');
  });
});

describe('the first run is one sequence: welcome → notifications → tour → setup', () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (globalThis as never as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
    } as Storage;
    (globalThis as never as { window: unknown }).window = { dispatchEvent: () => true } as never;
  });
  it('records its stage per athlete', async () => {
    const { readFirstRunStage, setFirstRunStage } = await import('@/lib/onboarding/first-run-flow');
    expect(readFirstRunStage('a1')).toBeNull();
    setFirstRunStage('a1', 'tour');
    expect(readFirstRunStage('a1')).toBe('tour');
    expect(readFirstRunStage('a2')).toBeNull();
  });
  it('the tour waits for the hand-off in v2 and skips its own welcome; finishing it ends the sequence', () => {
    const tour = read('components/onboarding/FirstRunTour.tsx');
    expect(tour).toMatch(/if \(v2\) \{\s+if \(readFirstRunStage\(localStorage\.getItem\('athlete_id'\)\) !== 'tour'\) return;\s+start\(\);/);
    expect(tour).toMatch(/if \(id\) setFirstRunStage\(id, 'done'\);/);
  });
  it('the flow is mounted with the other first-run steps, sends a test push on success, and "later" holds the old sheet off', () => {
    expect(read('app/(app)/layout.tsx')).toMatch(/\{popupsAllowed && <FirstRunFlow \/>\}/);
    const flow = read('components/onboarding/FirstRunFlow.tsx');
    expect(flow).toMatch(/fetch\('\/api\/push\/test'/);
    expect(flow).toMatch(/sessionStorage\.setItem\(PUSH_STEP_SESSION_SKIP_KEY, '1'\)/);
  });
});
