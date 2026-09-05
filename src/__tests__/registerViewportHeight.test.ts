import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * /register is the one page in the app specified to fit on a phone without
 * scrolling, so how it measures the viewport is load-bearing.
 *
 * It used to say `min-h-screen min-h-[100dvh]`, on the assumption that the second
 * class overrides the first and the first is the iOS 12 fallback. Both parts are
 * wrong: they are two rules of equal specificity, and Tailwind emits arbitrary
 * values BEFORE core utilities — so `.min-h-screen { min-height: 100vh }` came out
 * last and won in every browser. On iOS Safari 100vh is the viewport with the
 * toolbars ignored, which put roughly 120px of the page underneath Safari's own
 * chrome: the submit button, both footnotes and the wordmark were off-screen on a
 * real iPhone. Headless Chromium never reproduced it, and nothing failed.
 *
 * These are source assertions rather than DOM ones on purpose. The bug was in the
 * compiled cascade, which a jsdom test cannot see and a Playwright run only sees on
 * a device with browser chrome. What CAN be pinned cheaply is the shape of the fix.
 */

const root = join(__dirname, '..', '..');
const page = readFileSync(join(root, 'src/app/register/page.tsx'), 'utf8');
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
/** Both files name these classes in their comments to explain the bug; only the
 *  markup counts, so strip block comments before asserting on class names. */
const markup = page.replace(/\/\*[\s\S]*?\*\//g, '');

describe('/register viewport height', () => {
  it('never pairs min-h-screen with min-h-[100dvh] again', () => {
    expect(markup).not.toContain('min-h-screen');
    expect(markup).not.toContain('min-h-[100dvh]');
  });

  it('uses the single min-h-viewport utility on both screens', () => {
    // Form screen and success screen, outer wrapper and inner column each.
    expect(markup.split('min-h-viewport').length - 1).toBe(4);
  });

  it('declares all three units inside one rule, so file order cannot decide it', () => {
    const rule = css.match(/\.min-h-viewport\s*\{([^}]*)\}/);
    expect(rule, 'min-h-viewport is missing from globals.css').toBeTruthy();
    const body = rule![1];
    // Order matters WITHIN the rule: least to most correct, so an unsupported unit
    // falls back to the previous line instead of leaving no min-height at all.
    expect(body.indexOf('100vh')).toBeGreaterThan(-1);
    expect(body.indexOf('100dvh')).toBeGreaterThan(body.indexOf('100vh'));
    expect(body.indexOf('100svh')).toBeGreaterThan(body.indexOf('100dvh'));
  });

  it('leaves room for the home indicator, which svh does not account for', () => {
    // In standalone (installed) mode there are no toolbars, so svh is the whole
    // screen and the bottom 34px belongs to the home bar. max() makes this a no-op
    // wherever the inset is 0.
    expect(markup).toContain('pb-[max(1.25rem,env(safe-area-inset-bottom))]');
  });
});
