import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('sign in with a code by email', () => {
  beforeAll(() => { process.env.ENCRYPTION_KEY = 'k'.repeat(40); });

  it('codes are six digits, hashed per address, and compared in constant time', async () => {
    const { newCode, hashCode, codeMatches, normaliseCode } = await import('@/lib/auth/email-code');
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
    const h = hashCode('Noa@Gmail.com ', '012345')!;
    expect(codeMatches('noa@gmail.com', '012345', h)).toBe(true);
    expect(codeMatches('noa@gmail.com', '012346', h)).toBe(false);
    // Bound to the address: the same code's hash does not open another account.
    expect(codeMatches('dan@gmail.com', '012345', h)).toBe(false);
    expect(normaliseCode('012 345')).toBe('012345');
  });

  it('never says whether an address is a member, and only an approved one gets a code', () => {
    const r = read('app/api/auth/email-code/route.ts');
    expect(r).toMatch(/if \(!member\) return NextResponse\.json\(\{ ok: true \}\);/);
    expect(r).toMatch(/data\.approved !== true \|\| data\.status === 'removed'/);
  });

  it('caps sends and tries, burns codes on use, and lets an approved invitee in as active', () => {
    const r = read('app/api/auth/email-code/route.ts');
    expect(r).toMatch(/\(count \?\? 0\) >= MAX_SENDS/);
    expect(r).toMatch(/row\.attempts >= MAX_ATTEMPTS/);
    expect(r).toMatch(/await supabase\.from\('login_codes'\)\.delete\(\)\.eq\('email', email\);/);
    expect(r).toMatch(/if \(member\.status === 'invited'\) await supabase\.from\('athletes'\)\.update\(\{ status: 'active' \}\)/);
    expect(r).toMatch(/createSyntheticSession\(admin, email,/);
  });

  it('is offered on the landing page under Strava', () => {
    const page = read('app/page.tsx');
    expect(page).toMatch(/אין לי Strava · כניסה עם קוד במייל/);
    expect(page).toMatch(/<EmailCodeSheet open=\{showEmailCode\}/);
    expect(read('components/auth/EmailCodeSheet.tsx')).toMatch(/autoComplete="one-time-code"/);
  });
});
