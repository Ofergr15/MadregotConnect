import { webkit, devices } from 'playwright';

const BASE = 'https://madregot-connect.vercel.app';
const ATHLETE_ID = '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81';

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'he-IL' });
await context.addInitScript((athleteId) => {
  localStorage.setItem('athlete_id', athleteId);
  localStorage.setItem('coach_email', 'grosfeldofer@gmail.com');
  Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
}, ATHLETE_ID);
const page = await context.newPage();

console.log('[1] Navigate to profile, open Notification Prefs');
await page.goto(`${BASE}/dashboard/profile`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /העדפות התראות/ }).click();
await page.waitForTimeout(500);
console.log('    URL:', page.url());

const switchEl = page.getByRole('switch', { name: 'עדכונים והודעות כלליות' });
const initial = await switchEl.getAttribute('aria-checked');
console.log('[2] Initial switch state:', initial);

console.log('[3] Click switch...');
await switchEl.click();
await page.waitForTimeout(1200);
const afterClick = await switchEl.getAttribute('aria-checked');
console.log('    State right after click:', afterClick, afterClick !== initial ? '(flipped ✓)' : '(DID NOT FLIP ✗)');

console.log('[4] Refresh the page (real reload, not SPA nav)...');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
console.log('    URL after reload:', page.url());
const stillOnTab = await page.getByRole('switch', { name: 'עדכונים והודעות כלליות' }).isVisible().catch(() => false);
console.log('    Still on Notification Prefs tab (not bounced to landing):', stillOnTab);
const afterReload = await page.getByRole('switch', { name: 'עדכונים והודעות כלליות' }).getAttribute('aria-checked').catch(() => 'ELEMENT NOT FOUND');
console.log('    State survived reload:', afterReload, afterReload === afterClick ? '(matches ✓)' : '(MISMATCH ✗)');

await page.screenshot({ path: '/tmp/verify-final.png' });
console.log('[5] Screenshot saved to /tmp/verify-final.png');

await browser.close();
