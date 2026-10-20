import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Ofer, testing on 2026-10-20: the approval link opened details → "Strava" or "later",
// and "later" ended on the public landing page, signed out — no way in for a member
// without Strava. The join page now offers the welcome screen's email code for the link.
const join = readFileSync(resolve('src/app/join/[token]/page.tsx'), 'utf8');
const welcome = readFileSync(resolve('src/app/welcome/page.tsx'), 'utf8');
const he = JSON.parse(readFileSync(resolve('messages/he.json'), 'utf8'));
const en = JSON.parse(readFileSync(resolve('messages/en.json'), 'utf8'));

describe('joining without Strava', () => {
  it('the connect step has an email-code button that saves the details, then opens /welcome?t=<token>', () => {
    expect(join).toContain('data-testid="join-email-code"');
    const handler = join.slice(join.indexOf('const signInWithCode'), join.indexOf('const finishWithoutCredentials'));
    expect(handler).toContain('await persistProfile()');
    expect(handler).toContain('/welcome?t=${encodeURIComponent(token)}');
  });
  it('"later" no longer ends on the signed-out landing page', () => {
    expect(join).toContain("const doneHref = skippedGarmin\n    ? `/welcome?t=${encodeURIComponent(token)}`");
  });
  it('the welcome screen sends the code to the link\'s own address', () => {
    expect(welcome).toContain("action: 'who', token: t");
    expect(welcome).toContain("{ token, ...body }");
  });
  it('has the strings in both languages', () => {
    for (const k of ['signInWithCode', 'signInWithCodeHint', 'signInToApp']) {
      expect(he.join[k]).toBeTruthy();
      expect(en.join[k]).toBeTruthy();
    }
  });
});

describe('the setup\'s closing screen says only what is true', () => {
  const gate = readFileSync(resolve('src/components/setup/SetupGate.tsx'), 'utf8');
  it('names Strava only when it is connected, the home-screen app only when installed, push only when on', () => {
    const done = gate.slice(gate.indexOf('function DoneStep'), gate.indexOf('export function SetupGate'));
    expect(done).toContain("strava ? 'Strava מחובר' : 'נכנסת עם קוד במייל'");
    expect(done).toContain("installed ? ['האפליקציה במסך הבית'] : ['ממשיכים בדפדפן'");
    expect(done).toContain('...(push ?');
    expect(gate).toContain('<DoneStep garmin={!!data?.garmin} strava={!!data?.strava} installed={standalone} push={!!data?.push}');
  });
});
