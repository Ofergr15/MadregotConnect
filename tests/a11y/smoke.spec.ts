import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ME_ID, SEED_NOW, seededAnswer, seededSession } from './seeded-club';

/**
 * Smoke + accessibility on SEEDED data (task 111). axe.spec.ts audits the empty states
 * (every API answers `{}`); this file answers the main reads with a fixed fake club
 * (seeded-club.ts) so each page renders real content, then checks three things:
 *
 *   1. the page did not fall into the crash screen and threw no uncaught error,
 *   2. a piece of seeded content is on screen (the page drew data, not a skeleton),
 *   3. axe finds no serious/critical WCAG 2.x A/AA violation in that rendered page.
 *
 * Same fake-env build as axe.spec.ts (playwright.a11y.config.ts): no real database, no
 * real API. The page clock is pinned to SEED_NOW so dates and weeks are stable.
 *
 *   npm run test:a11y                      # build + both specs
 *   A11Y_SKIP_BUILD=1 npm run test:a11y    # reuse the last .next build
 */

const ME = {
  role: 'coach', roles: ['coach'], membership: 'active', isAcademy: false, academyOnly: false,
  isSuper: false, canApprove: true, isCoreRunner: false, qualitySession: false, isClubManager: false, contentLevels: {},
};

async function mockSeeded(page: Page) {
  await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/api/auth/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
    const body = r.request().method() === 'GET' ? seededAnswer(url.pathname, url.searchParams) : undefined;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body ?? {}) });
  });
  await page.route(/posthog|tile\.openstreetmap|basemaps|mapbox|arcgisonline/, (r) => r.abort());
}

// `expectText`: seeded content that proves the page drew the data.
const PAGES: Array<{ path: string; signedIn: boolean; expectText?: string }> = [
  { path: '/', signedIn: false, expectText: '48,210' },
  { path: '/register', signedIn: false },
  { path: '/feed', signedIn: true, expectText: 'פארק הירקון' },
  { path: '/dashboard', signedIn: true, expectText: 'איתי כהן' },
  { path: '/dashboard/week', signedIn: true, expectText: 'נועה, השבוע אצלך' },
  { path: '/dashboard/records', signedIn: true, expectText: 'נועה לוי' },
  { path: '/dashboard/athletes', signedIn: true, expectText: 'ליאור בן דוד' },
  { path: '/dashboard/groups', signedIn: true, expectText: 'נועה לוי' },
  { path: '/dashboard/activities', signedIn: true, expectText: 'אימון קבוצתי' },
  { path: '/dashboard/profile', signedIn: true, expectText: 'אימון קבוצתי' },
];

for (const p of PAGES) {
  test(`seeded smoke + axe: ${p.path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    await page.clock.setFixedTime(SEED_NOW);
    await mockSeeded(page);
    if (p.signedIn) {
      await page.addInitScript(({ athleteId, session }) => {
        try {
          localStorage.setItem('athlete_id', athleteId);
          localStorage.setItem('NEXT_LOCALE', 'he');
          localStorage.setItem(session.key, session.value);
        } catch { /* private mode */ }
      }, { athleteId: ME_ID, session: seededSession() });
    }
    await page.goto(p.path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(new URL(page.url()).pathname, `${p.path} redirected away`).toBe(p.path);
    if (p.expectText) await expect(page.getByText(p.expectText).first(), `${p.path} did not draw the seeded data`).toBeVisible();
    expect(await page.getByText('חזרה לדף הבית').count(), `${p.path} rendered the crash screen: ${errors.join(' | ')}`).toBe(0);
    expect(errors, `${p.path} threw`).toEqual([]);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('[data-testid="dev-toolbar"]')
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const fmt = (vs: typeof results.violations) =>
      vs.map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
    const soft = results.violations.filter((v) => !blocking.includes(v));
    if (soft.length) console.log(`[a11y seeded] ${p.path} non-blocking:\n${fmt(soft)}`);
    expect(blocking, `${p.path}\n${fmt(blocking)}`).toEqual([]);
  });
}
