import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility CI (task 68): axe-core over the 10 main web pages.
 *
 * Runs against a production build made with PLACEHOLDER Supabase env (the same as
 * the CI build step), and every network call the page makes is answered here:
 * `/api/**` with minimal fixtures, Supabase with an empty 200. Nothing reaches a
 * real database, so no real data is read and nothing is written — a page renders
 * its empty / loading state, which is where most label and landmark bugs live.
 *
 * Signed-in pages get in the way the shell already admits a legacy session: an
 * `athlete_id` in localStorage (see app/(app)/layout.tsx) + a mocked /api/auth/me.
 *
 *   npm run test:a11y            # builds with placeholders, starts, runs this file
 *
 * Fails on `serious` and `critical` violations. `moderate`/`minor` are printed, not
 * failed, so the gate can tighten later without one PR fixing everything at once.
 */

const ATHLETE_ID = '00000000-0000-4000-8000-0000000000a1';

const ME = {
  role: 'coach', roles: ['coach'], membership: 'active', isAcademy: false, academyOnly: false,
  isSuper: false, canApprove: true, isCoreRunner: false, qualitySession: false, isClubManager: false, contentLevels: {},
};

async function mockNetwork(page: Page) {
  await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/api/auth/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // Third-party analytics/maps tiles: not ours to audit, and offline in CI.
  await page.route(/posthog|tile\.openstreetmap|basemaps|mapbox/, (r) => r.abort());
}

async function signIn(page: Page) {
  await page.addInitScript((id) => {
    try { localStorage.setItem('athlete_id', id); localStorage.setItem('NEXT_LOCALE', 'he'); } catch { /* private mode */ }
  }, ATHLETE_ID);
}

// `fixture: false` = the page crashes on the generic `{}` API answer and needs a real
// fixture before it can be audited (tracked in the PR); kept listed so it isn't forgotten.
const PAGES: Array<{ path: string; signedIn: boolean; fixture?: false }> = [
  { path: '/', signedIn: false, fixture: false },
  { path: '/register', signedIn: false },
  { path: '/feed', signedIn: true },
  { path: '/dashboard', signedIn: true },
  { path: '/dashboard/week', signedIn: true, fixture: false },
  { path: '/dashboard/records', signedIn: true, fixture: false },
  { path: '/dashboard/athletes', signedIn: true },
  { path: '/dashboard/groups', signedIn: true },
  { path: '/dashboard/activities', signedIn: true },
  { path: '/dashboard/profile', signedIn: true },
];

for (const p of PAGES) {
  test(`axe: ${p.path}`, async ({ page }) => {
    test.fixme(p.fixture === false, 'needs a response fixture: crashes on an empty API body');
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200)); });
    await mockNetwork(page);
    if (p.signedIn) await signIn(page);
    await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);

    // A page that threw renders CrashScreen; auditing that would pass/fail the wrong UI.
    const crashed = await page.getByText('חזרה לדף הבית').count();
    expect(crashed, `${p.path} rendered the crash screen: ${pageErrors.slice(0, 3).join(' | ')}`).toBe(0);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // Our own dev overlay, not the product.
      .exclude('[data-testid="dev-toolbar"]')
      .analyze();

    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const soft = results.violations.filter((v) => !blocking.includes(v));
    const fmt = (vs: typeof results.violations) =>
      vs.map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
    if (soft.length) console.log(`[a11y] ${p.path} non-blocking:\n${fmt(soft)}`);
    expect(blocking, `${p.path}\n${fmt(blocking)}`).toEqual([]);
  });
}
