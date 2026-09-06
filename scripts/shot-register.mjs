// Renders /register off the dev server at every phone height it has to survive and
// reports overflow + the vertical box of the new date line. Must live here, not in
// /tmp: playwright resolves from the repo's node_modules.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.HOME + '/.cache/madregot/register-after';
mkdirSync(OUT, { recursive: true });
const SIZES = [[430, 790], [390, 844], [390, 734], [375, 667], [320, 480]];

const b = await chromium.launch();
for (const [w, h] of SIZES) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:3000/register', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const box = (t) => {
      const el = [...document.querySelectorAll('p')].find((n) => n.textContent.trim().startsWith(t));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    return {
      overflow: document.documentElement.scrollHeight - window.innerHeight,
      label: box('להשקת'),
      date: box('יום חמישי'),
    };
  });
  console.log(`${w}x${h}  overflow=${m.overflow}  label=${JSON.stringify(m.label)}  date=${JSON.stringify(m.date)}`);
  await p.screenshot({ path: `${OUT}/day-${w}x${h}.png` });
}
await b.close();
