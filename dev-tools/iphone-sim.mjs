#!/usr/bin/env node
// Real Safari-engine (WebKit) + real iPhone 15 emulation, against production
// (or a --local override), signed in as a real athlete via localStorage and
// simulating an installed standalone PWA — as close to a real device as this
// environment can get, and much closer than Chromium-based testing (which
// can't reproduce iOS Safari/WebKit-specific bugs like the ones this app has
// hit: navigator.standalone gates, backdrop-filter+fixed compositing, etc).
//
// Usage:
//   node dev-tools/iphone-sim.mjs <path> [screenshotPath] [--local] [--athlete=<id>] [--email=<email>]
//
// Examples:
//   node dev-tools/iphone-sim.mjs /dashboard/profile
//   node dev-tools/iphone-sim.mjs /dashboard/settings?tab=notifications /tmp/nc.png --local
//
// Prints every /api/ request+response and any console/page error. Always
// screenshots (default path /tmp/iphone-sim.png) so you can visually check
// layout, not just logs.
import { webkit, devices } from 'playwright';

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const athleteArg = args.find((a) => a.startsWith('--athlete='));
const emailArg = args.find((a) => a.startsWith('--email='));
const positional = args.filter((a) => !a.startsWith('--'));

const BASE = isLocal ? 'http://localhost:3000' : 'https://madregot-connect.vercel.app';
const ATHLETE_ID = athleteArg ? athleteArg.split('=')[1] : '4e7d7c0f-3a13-4c86-a5f8-b103f1506f81';
const EMAIL = emailArg ? emailArg.split('=')[1] : 'grosfeldofer@gmail.com';

const path = positional[0] || '/dashboard';
const screenshotPath = positional[1] || '/tmp/iphone-sim.png';

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'he-IL' });

await context.addInitScript(({ athleteId, email }) => {
  localStorage.setItem('athlete_id', athleteId);
  localStorage.setItem('athlete_name', 'Ofer G');
  localStorage.setItem('athlete_email', email);
  localStorage.setItem('coach_email', email);
  // Matches an installed home-screen PWA, not a fresh Safari tab — several
  // real bugs this session only manifested (or only got suppressed/shown
  // correctly) depending on this flag.
  Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
}, { athleteId: ATHLETE_ID, email: EMAIL });

const page = await context.newPage();

const apiLog = [];
page.on('request', (req) => {
  if (req.url().includes('/api/')) {
    const body = req.method() !== 'GET' ? ` ${req.postData() || ''}` : '';
    apiLog.push(`→ ${req.method()} ${req.url().replace(BASE, '')}${body}`);
  }
});
page.on('response', async (res) => {
  if (res.url().includes('/api/')) {
    let body = '';
    try { body = (await res.text()).slice(0, 300); } catch {}
    apiLog.push(`← ${res.status()} ${res.url().replace(BASE, '')} ${body}`);
  }
});
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: screenshotPath, fullPage: false });

console.log(`=== ${BASE}${path} ===`);
console.log('--- API log ---');
console.log(apiLog.join('\n') || '(none)');
console.log('--- console/page errors ---');
console.log(errors.join('\n') || '(none)');
console.log('--- screenshot ---', screenshotPath);

// Leaves `page`/`context`/`browser` closed — this is a one-shot snapshot tool.
// For interactive testing (clicking, filling forms), write a one-off script
// that imports the same setup (see the addInitScript block above) and drives
// `page` directly with Playwright's normal API before closing.
await browser.close();
