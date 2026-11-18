import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { remainingSteps, type SetupFacts } from '@/lib/setup/gate';

/**
 * "לא מצליחים להתקין? ממשיכים בדפדפן" (bug on 2.41.497, QA Import21): the choice lived only in
 * SetupGate's state, so a reload or any remount brought the blocking install step back. It is
 * now stamped on the account (notification_prefs.setup.browserAt → browserChosen) without
 * ever marking the app installed.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
// A Safari tab on an iPhone, every other step done.
const tab: SetupFacts = { installed: false, phone: true, strava: true, garmin: false, noWatch: true, push: true, birthDate: '1990-03-14', heightCm: 178, sizes: ['M', 'M', 'S', '39-42', '43'], detailsConfirmed: true };

describe('continue in the browser', () => {
  it('an existing member without the fact behaves as before: the install step blocks', () => {
    expect(remainingSteps(tab)).toEqual(['install']);
    expect(remainingSteps({ ...tab, browserChosen: undefined })).toEqual(['install']);
  });
  it('persists across a reload: re-running the gate with the stored fact has no install step', () => {
    // First visit: chosen (in memory) → passes. Reload: memory is gone, the server fact holds.
    expect(remainingSteps({ ...tab, browserChosen: true })).toEqual([]);
    const afterReload = { ...tab, browserChosen: true };
    expect(remainingSteps(afterReload)).toEqual([]);
  });
  it('does not pass anything but the install step', () => {
    expect(remainingSteps({ ...tab, browserChosen: true, noWatch: false })).toEqual(['watch']);
    expect(remainingSteps({ ...tab, browserChosen: true, heightCm: null })).toEqual(['details']);
  });
  it('a device that later installs (standalone) is fine either way', () => {
    expect(remainingSteps({ ...tab, installed: true, browserChosen: true })).toEqual([]);
    expect(remainingSteps({ ...tab, installed: true, browserChosen: true, push: false })).toEqual(['push']);
  });

  const gate = src('src/components/setup/SetupGate.tsx');
  it('the gate keeps `installed` truthful: only standalone counts, the choice goes to browserChosen', () => {
    expect(gate).toMatch(/installed: standalone,/);
    expect(gate).not.toMatch(/installed: standalone \|\| installLater/);
    expect(gate).toMatch(/browserChosen: installLater \|\| !!data\.browserChosen/);
    // The closing screen still says "continue in the browser", not "installed".
    expect(gate).toMatch(/installed=\{standalone\}/);
  });
  it('the choice is written to the account, so navigation/remounts do not re-trigger the step', () => {
    expect(gate).toMatch(/JSON\.stringify\(\{ browser: true \}\)/);
  });

  const route = src('src/app/api/setup/route.ts');
  it('the API stores browserAt in notification_prefs.setup and reports browserChosen', () => {
    expect(route).toMatch(/browserChosen: typeof setup\.browserAt === 'string'/);
    expect(route).toMatch(/if \(browser && !setup\.browserAt\) setup\.browserAt = /);
    expect(route).not.toMatch(/setup\.installed/);
  });

  it('the profile install row and ?install=1 still open the install guide off the home screen', () => {
    const profile = src('src/app/(app)/dashboard/profile/page.tsx');
    expect(profile).toMatch(/setInstallable\(!standalone\)/);
    expect(profile).toMatch(/get\('install'\) === '1'\) setShowInstall\(true\)/);
    expect(profile).toMatch(/label=\{t\('installApp'\)\} onClick=\{\(\) => setShowInstall\(true\)\}/);
    expect(profile).not.toMatch(/browserChosen/);
  });
});

describe('a reload of a finished setup', () => {
  it('does not walk a phantom step before the device is known (no closing screen on reload)', () => {
    const gate = readFileSync(join(process.cwd(), 'src/components/setup/SetupGate.tsx'), 'utf8');
    expect(gate).toMatch(/if \(!data\?\.applicable \|\| !deviceKnown\) return \[\]/);
  });
});
