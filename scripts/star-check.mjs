// Is the new date line sitting on the banner's WHITE star, or on the flag's black?
// Contrast cannot answer this (white-on-scrim measures 6.5:1 even on the star), so:
// take the line's TIGHT glyph bounds, hide the foreground column, screenshot just
// that rectangle of bare photograph, and look at how bright it actually is.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/starcheck';
mkdirSync(OUT, { recursive: true });
const SIZES = [[430, 790], [390, 844], [390, 734], [375, 667], [320, 480]];
const b = await chromium.launch();

for (const [w, h] of SIZES) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:3000/register', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  for (const key of ['להשקת', 'יום חמישי']) {
    const rect = await p.evaluate((k) => {
      const el = [...document.querySelectorAll('p')].find((n) => n.textContent.trim().startsWith(k));
      if (!el) return null;
      const r = document.createRange();
      r.selectNodeContents(el);
      const g = r.getBoundingClientRect(); // tight glyph box, not the full-width <p>
      // Hide everything in front of the photo so the clip is bare photograph.
      const col = [...document.querySelectorAll('.min-h-viewport')].pop();
      if (col) col.style.visibility = 'hidden';
      return { x: Math.round(g.left), y: Math.round(g.top), width: Math.round(g.width), height: Math.round(g.height) };
    }, key);
    if (!rect || rect.width < 2) { console.log(`${w}x${h} ${key}: not found`); continue; }
    const file = `${OUT}/${w}x${h}-${key === 'להשקת' ? 'label' : 'date'}.png`;
    await p.screenshot({ path: file, clip: rect });
    console.log(`SHOT ${file} ${JSON.stringify(rect)}`);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
  }
}
await b.close();
