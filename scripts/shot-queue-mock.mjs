/**
 * Screenshot the /dashboard/settings?tab=registrations queue WITHOUT a session.
 *
 * The real screen is behind requireSession + canApprove and the local browser has
 * no external network, so Supabase auth can never complete here (see the
 * madregot-local-browser-verify note). This renders a static mock of the same
 * markup with the app's own compiled Tailwind instead — enough to judge the thing
 * Ofer complained about, which is layout and colour, not data.
 *
 * Regenerate the CSS after touching tailwind.config.ts or the row classes:
 *   npx tailwindcss -c /tmp/tw-preview.ts -i src/app/globals.css -o /tmp/q.css
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
for (const [w, h, tag] of [[430, 790, 'iphone-max'], [375, 667, 'iphone-se']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto('file:///tmp/queue-mock.html');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/queue-${tag}.png`, fullPage: true });
  // Any address that still truncates is the bug that started this.
  const clipped = await page.$$eval('span[dir="ltr"]', els =>
    els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
  console.log(tag, 'clipped addresses:', clipped.length, clipped);
  await page.close();
}
await browser.close();
