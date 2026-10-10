import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PUBLIC_PATHS } from '@/lib/public-paths';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('install first, then sign in once inside the app', () => {
  it('/join (v2) saves the details and goes to the guide, with no Strava or Garmin there', () => {
    const page = read('app/join/[token]/page.tsx');
    // …and the done screen knows nothing was connected (it used to say "your Garmin is linked").
    expect(page).toMatch(/if \(guideV2\) \{\s+setStep\('connecting'\);\s+persistProfile\(\)[\s\S]{0,240}?\.then\(\(\) => \{ (trackOnb\('join_saved', \{ token \}\); )?setSkippedGarmin\(true\); setStep\('done'\); \}\)/);
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

describe('on an iPhone browser the landing page is the install guide', () => {
  it('holds sign-in on iPhone only, after the session check, with one way out', () => {
    const page = read('app/page.tsx');
    expect(page).toMatch(/setInstallFirst\(v2 && \(p === 'ios-safari' \|\| p === 'ios-safari-26' \|\| p === 'ios-safari-compact' \|\| p === 'ios-inapp'\)\)/);
    expect(page).toMatch(/if \(!checking && installFirst && !browserEscape\) \{\s+return <InstallGuide canPrompt=\{false\} onLater=\{\(\) => \{\}\} blocking onEscape=\{\(\) => setBrowserEscape\(true\)\} \/>;/);
    const g = read('components/install/InstallGuide.tsx');
    expect(g).toMatch(/\{!blocking && <button type="button" onClick=\{onLater\}/);
    expect(g).toMatch(/לא מצליחים להתקין\? כניסה בדפדפן/);
  });
});

describe('"what\'s new" waits for the first run, and a new member never gets it', () => {
  const base = { applicable: true, migrated: true, tourSeen: true, tourSeenAt: '2026-09-01T08:00:00Z', completed: false, completedAt: null } as never;
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  it('waits for the install step, the tour and an askable notifications step', async () => {
    const { whatsNewTiming } = await import('@/lib/onboarding/first-run-order');
    expect(whatsNewTiming(undefined, true, 'granted', NOW)).toBe('wait');
    expect(whatsNewTiming(base, false, 'granted', NOW)).toBe('wait');
    expect(whatsNewTiming({ ...(base as object), tourSeen: false } as never, true, 'granted', NOW)).toBe('wait');
    expect(whatsNewTiming(base, true, 'granted', NOW)).toBe('open');
  });
  it('a member whose tour ended in the last three days: spent quietly', async () => {
    const { whatsNewTiming } = await import('@/lib/onboarding/first-run-order');
    expect(whatsNewTiming({ ...(base as object), tourSeenAt: '2026-10-06T07:00:00Z' } as never, true, 'granted', NOW)).toBe('quiet');
  });
  it('the auto-sheet asks it (unless the release push was tapped), and the test reset is the super user\'s alone', () => {
    const sheet = read('components/whats-new/WhatsNewSheet.tsx');
    expect(sheet).toMatch(/if \(v2 && !asked\) \{\s+const timing = whatsNewTiming\(/);
    const api = read('app/api/onboarding/route.ts');
    expect(api).toMatch(/if \(resetForTest\) \{\s+if \(!auth\.user\.isSuperUser\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\);/);
  });
});

describe('the first notifications tap on a fresh install', () => {
  it('the worker precaches the app shell only (the 20 MB manifest made it wait), and the wait is bounded', () => {
    const route = read('app/serwist/[path]/route.ts');
    expect(route).toMatch(/manifest: entries\.filter\(\(e\) => isAppShell\(e\.url\)\)/);
    expect(route).toMatch(/replace\(\/\^\(\\\.next\|_next\|public\)\\\/\/, ''\)/);
    const pwa = read('lib/pwa.ts');
    expect(pwa).toMatch(/if \(!reg\) return \{ ok: false, error: 'sw_not_ready' \};/);
    expect(read('components/onboarding/NotificationsStep.tsx')).toMatch(/error === 'sw_not_ready'/);
  });
  it('the landing guide greets before it instructs', () => {
    const g = read('components/install/InstallGuide.tsx');
    expect(g).toMatch(/const \[intro, setIntro\] = useState\(!!blocking\);/);
    expect(g).toMatch(/בואו נתחיל ▶/);
  });
});
