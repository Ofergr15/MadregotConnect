import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// Q26-1 (QA 26.11): the email sheet's Strava fallback must use the standalone-PWA
// handoff, or the 12 members with no real email cannot sign in from the installed app.
describe('email sheet Strava fallback', () => {
  it('goes through useStravaLogin, never a bare ?mode=login', () => {
    const sheet = read('components/auth/EmailCodeSheet.tsx');
    expect(sheet).toMatch(/useStravaLogin\(\)/);
    expect(sheet).toMatch(/onClick=\{strava\.signIn\}/);
    expect(sheet).not.toMatch(/strava\?mode=login/);
  });

  it('the hook clears the local identity, then stores a verifier and sends challenge=', () => {
    const hook = read('lib/auth/use-strava-login.ts');
    const clear = hook.indexOf('await clearLocalIdentity()');
    const store = hook.indexOf('storePendingVerifier(verifier)');
    expect(clear).toBeGreaterThan(-1);
    expect(store).toBeGreaterThan(clear);
    expect(hook).toMatch(/\/api\/strava\?mode=login&challenge=\$\{encodeURIComponent\(challenge\)\}/);
  });

  it('the orange button uses ink-900 text (4.87:1), not white (3.40:1)', () => {
    const sheet = read('components/auth/EmailCodeSheet.tsx');
    const btn = sheet.slice(sheet.indexOf('onClick={strava.signIn}'), sheet.indexOf('כניסה עם Strava'));
    expect(btn).toMatch(/bg-\[#FC4C02\][^"]*text-ink-900/);
    expect(btn).not.toMatch(/text-white/);
  });
});
