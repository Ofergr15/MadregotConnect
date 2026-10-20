import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * pdf.js 6's modern build calls Map.prototype.getOrInsertComputed (ES2026) on every
 * page render; Safari 18 (iOS 18 iPhones) doesn't have it. The render threw inside
 * the viewer's own try, so the program PDF showed as blank white pages — measured in
 * WebKit with the method removed: 0 of 6 pages drawn, against 4 of 6 (the rest below
 * the fold) on the legacy build, which carries the core-js polyfill.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('pdf.js build', () => {
  it('the viewers load the legacy build', () => {
    for (const f of ['components/PlanPdfViewer.tsx', 'components/NutritionPlanView.tsx']) {
      expect(read(f)).toMatch(/import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
      expect(read(f)).not.toMatch(/import\('pdfjs-dist'\)/);
    }
  });
  // #134: with the browser loading the plan's embedded subset fonts, the text drew in a
  // fallback font at the PDF's widths — spread letters, lost colons, Hebrew out of order.
  it('the viewers draw glyphs themselves (disableFontFace)', () => {
    for (const f of ['components/PlanPdfViewer.tsx', 'components/NutritionPlanView.tsx']) {
      expect(read(f)).toMatch(/getDocument\(\{ url, disableFontFace: true \}\)/);
    }
  });
  it('and the worker is the legacy one too', () => {
    expect(readFileSync(new URL('../../scripts/copy-pdf-worker.mjs', import.meta.url), 'utf8')).toMatch(/join\(dirname\(pkg\), 'legacy', 'build', 'pdf\.worker\.min\.mjs'\)/);
  });
});
