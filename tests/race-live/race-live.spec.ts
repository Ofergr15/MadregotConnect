import { expect, test, type Page } from '@playwright/test';
import { EVENT, EVENT_ID, ME, ME_ID, RUNNERS, SEED_NOW, seededSession } from './seeded-race';

/**
 * Race-live smoke on SEEDED data (round 6, task 174): the web live viewer
 * (/dashboard/race-live/[eventId]) and its entry button on the event page. Valencia is
 * 6.12, so this is the screen that has to hold on race morning.
 *
 * Fake-env build (playwright.race.config.ts): no real database, no real API. Every
 * /api request is answered here; the page clock is pinned to SEED_NOW so "how old is
 * this position" is stable.
 *
 *   npm run test:race-live                       # build + run
 *   RACE_SKIP_BUILD=1 npm run test:race-live     # reuse the last .next build
 */

type Answer = { status?: number; body: unknown };

async function signedIn(page: Page, answers: Record<string, Answer>) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.clock.setFixedTime(SEED_NOW);
  await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/**', (r) => {
    const { pathname } = new URL(r.request().url());
    const a = pathname === '/api/auth/me' ? { body: ME } : answers[pathname];
    return r.fulfill({ status: a?.status ?? 200, contentType: 'application/json', body: JSON.stringify(a?.body ?? {}) });
  });
  await page.route(/posthog|tile\.openstreetmap|basemaps|mapbox|arcgisonline/, (r) => r.abort());
  await page.addInitScript(({ athleteId, session }) => {
    try {
      localStorage.setItem('athlete_id', athleteId);
      localStorage.setItem('NEXT_LOCALE', 'he');
      localStorage.setItem(session.key, session.value);
    } catch { /* private mode */ }
  }, { athleteId: ME_ID, session: seededSession() });
  return errors;
}

const BOARD = `/api/race-live/${EVENT_ID}`;
const VIEWER = `/dashboard/race-live/${EVENT_ID}`;

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  expect(new URL(page.url()).pathname, `${path} redirected away`).toBe(path);
}

test.describe('race-live viewer', () => {
  test('draws one row per runner state', async ({ page }) => {
    const errors = await signedIn(page, { [BOARD]: { body: { enabled: true, active: true, runners: RUNNERS, updatedAt: SEED_NOW.toISOString() } } });
    await open(page, VIEWER);

    await expect(page.getByRole('heading', { name: 'מעקב חי' })).toBeVisible();
    const rows = page.locator('li[data-kind]');
    await expect(rows).toHaveCount(RUNNERS.length);
    await expect(page.locator('li[data-kind="finished"]')).toContainText('סיום · 3:12:05');
    await expect(page.locator('li[data-kind="position"][data-stale="0"]')).toContainText('23.4 ק״מ · 1:52:10');
    const stale = page.locator('li[data-kind="position"][data-stale="1"]');
    await expect(stale).toContainText('18.1 ק״מ · 1:43:20');
    await expect(stale).toContainText('לא מעודכן (לפני 6 דק׳)');
    await expect(page.locator('li[data-kind="last_split"]')).toContainText('25K · 2:01:33');
    await expect(page.locator('li[data-kind="not_started"]')).toHaveCount(1);
    // The runner's own row is marked; a finished runner shows no prediction.
    await expect(page.locator('li[data-kind="finished"]')).toContainText('Noa Levin');
    await expect(page.locator('li[data-kind="finished"] [title="סיום צפוי"]')).toHaveCount(0);
    await expect(page.getByText('לא פעיל כרגע')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('says the tracking is not open when the board is off for this member', async ({ page }) => {
    const errors = await signedIn(page, { [BOARD]: { body: { enabled: false } } });
    await open(page, VIEWER);
    await expect(page.getByText('המעקב החי עוד לא פתוח.')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('marks an inactive board and an empty field', async ({ page }) => {
    const errors = await signedIn(page, { [BOARD]: { body: { enabled: true, active: false, runners: [] } } });
    await open(page, VIEWER);
    await expect(page.getByText('לא פעיל כרגע')).toBeVisible();
    await expect(page.getByText('אין רצים במעקב.')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failing board shows the retry message, not the crash screen', async ({ page }) => {
    const errors = await signedIn(page, { [BOARD]: { status: 500, body: { error: 'Internal error' } } });
    await open(page, VIEWER);
    await expect(page.getByText('לא הצלחנו לטעון את המעקב. ננסה שוב בעוד רגע.')).toBeVisible();
    expect(await page.getByText('חזרה לדף הבית').count()).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('event page entry button', () => {
  const EVENT_API = `/api/events/${EVENT_ID}`;
  const LINK = `/api/race-live/${EVENT_ID}/link`;
  const REGS = `/api/events/${EVENT_ID}/registrations`;
  const NO_REGISTRATIONS = { participants: [], registeredCount: 0, waitlistCount: 0, capacity: null };

  test('"live" opens the viewer', async ({ page }) => {
    await signedIn(page, {
      [EVENT_API]: { body: { event: EVENT } },
      [REGS]: { body: NO_REGISTRATIONS },
      [LINK]: { body: { button: 'live' } },
      [BOARD]: { body: { enabled: true, active: true, runners: RUNNERS } },
    });
    await open(page, `/dashboard/calendar/${EVENT_ID}`);
    const button = page.locator('a[data-live-button="live"]');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(new RegExp(`${VIEWER}$`));
    await expect(page.locator('li[data-kind]')).toHaveCount(RUNNERS.length);
  });

  test('no button outside the race window', async ({ page }) => {
    await signedIn(page, { [EVENT_API]: { body: { event: EVENT } }, [REGS]: { body: NO_REGISTRATIONS }, [LINK]: { body: { button: null } } });
    await open(page, `/dashboard/calendar/${EVENT_ID}`);
    await expect(page.getByText(EVENT.name).first()).toBeVisible();
    await expect(page.locator('a[data-live-button]')).toHaveCount(0);
  });
});
