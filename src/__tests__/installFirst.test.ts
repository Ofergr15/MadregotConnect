import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PUBLIC_PATHS } from '@/lib/public-paths';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('install first, then sign in once inside the app', () => {
  it('/join (v2) saves the details and goes to the guide, with no Strava or Garmin there', () => {
    const page = read('app/join/[token]/page.tsx');
    expect(page).toMatch(/if \(guideV2\) \{\s+setStep\('connecting'\);\s+persistProfile\(\)\s+\.then\(\(\) => setStep\('done'\)\)/);
  });

  it('the icon added from /join opens the member\'s welcome; a phone that saved /join is forwarded', async () => {
    expect(read('app/join/[token]/layout.tsx')).toMatch(/manifest: `\/api\/public\/manifest\?t=\$\{encodeURIComponent\(token\)\}`/);
    const { GET } = await import('@/app/api/public/manifest/route');
    const m = await (await GET(new Request('https://x/api/public/manifest?t=abc12345tok'))).json();
    expect(m.start_url).toBe('/welcome?t=abc12345tok');
    expect(m.id).toBe('/dashboard');
    const bad = await (await GET(new Request('https://x/api/public/manifest?t=<script>'))).json();
    expect(bad.start_url).toBe('/feed');
    expect(read('app/join/[token]/page.tsx')).toMatch(/if \(isStandalone\(\)\) \{\s+window\.location\.replace\(`\/welcome\?t=/);
  });

  it('the welcome signs in by the link, never shows the full address, and is a public page', () => {
    const api = read('app/api/auth/email-code/route.ts');
    expect(api).toMatch(/if \(body\?\.action === 'who'\)/);
    expect(api).toMatch(/maskedEmail: maskEmail\(email\)/);
    expect(api).toMatch(/\.from\('athletes'\)\.select\('email'\)\.eq\('invite_token', token\)/);
    expect(PUBLIC_PATHS).toContain('/welcome');
    expect(read('app/welcome/page.tsx')).toMatch(/autoComplete="one-time-code"/);
  });
});

describe('the missing steps come back every day for a week', () => {
  it('"later" hides it for today only, and seven days is the limit', async () => {
    const { nudgeAllowedV2, skipNudgeForToday, recordNudgeShown, NUDGE_V2_DAYS } = await import('@/lib/onboarding/nudge-ledger');
    let l = { days: [] as string[], skipped: false };
    expect(nudgeAllowedV2(l, '2026-10-06')).toBe(true);
    l = recordNudgeShown(l, '2026-10-06');
    const skipped = skipNudgeForToday(l, '2026-10-06');
    expect(nudgeAllowedV2(skipped, '2026-10-06')).toBe(false);
    expect(nudgeAllowedV2(skipped, '2026-10-07')).toBe(true);
    let week = { days: [] as string[], skipped: false };
    for (let d = 1; d <= NUDGE_V2_DAYS; d++) week = recordNudgeShown(week, `2026-10-0${d}`);
    expect(nudgeAllowedV2(week, '2026-10-08')).toBe(false);
    expect(NUDGE_V2_DAYS).toBe(7);
  });
});
