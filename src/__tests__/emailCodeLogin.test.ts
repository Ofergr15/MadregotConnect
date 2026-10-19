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

describe('phase 4: nobody stuck quietly', () => {
  it('approving an athlete closes the request they came in on', () => {
    const r = read('app/api/admin/approve/route.ts');
    expect(r).toMatch(/\.from\('signup_requests'\)\s+\.update\(\{ status: 'approved', approved_at: updates\.approved_at, approved_by: updates\.approved_by \}\)\s+\.eq\('athlete_id', athleteId\)\s+\.eq\('status', 'pending'\)/);
  });

  it('the 48h reminder: v2 approvals only, still invited, never seen, real address, once', async () => {
    const { runJoinReminders, isSynthetic } = await import('@/lib/onboarding/join-reminder');
    expect(isSynthetic('strava_1@strava.madregot.local')).toBe(true);
    expect(isSynthetic('noa@gmail.com')).toBe(false);
    const src = read('lib/onboarding/join-reminder.ts');
    expect(src).toMatch(/a\.status !== 'invited' \|\| a\.last_seen_at \|\| !a\.invite_token \|\| isSynthetic\(a\.email\)/);
    expect(src).toMatch(/if \(await ledger\.already\(tag\)\) continue;/);
    expect(typeof runJoinReminders).toBe('function');
    expect(read('app/api/cron/tick/route.ts')).toMatch(/if \(hour === 10\) \{\s+try \{\s+const reminded = await runJoinReminders/);
  });
});
