import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  canZoom,
  clampZoom,
  FIT_ZOOM,
  MAX_CANVAS_EDGE,
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  renderScale,
  stepZoom,
  zoomScroll,
} from '@/lib/pdf/zoom';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const VIEWER = readFileSync(join(SRC, 'components/PlanPdfViewer.tsx'), 'utf8');

/**
 * THE PLAN PDF'S ZOOM.
 *
 * "the zoom in the pdf section is not working properly - only by the buttons / and
 * even with buttons - the zoom break the image".
 *
 * Two separate faults behind one complaint:
 *
 *  1. Zoom was an INDEX into a ladder, so nothing could hold the 1.37 a pinch
 *     produces — there was no gesture handler at all, and no page-level pinch to
 *     fall back on either, because iOS gives an installed PWA none.
 *  2. Every zoom change started a `page.render()` on a canvas whose previous render
 *     was still cancelling. pdf.js refuses that, and the rejection was swallowed, so
 *     the page went white.
 */

describe('the zoom ladder', () => {
  it('holds a value the buttons would never produce', () => {
    // The pinch's answer, kept as-is. An index could not represent it, which is the
    // reason pinching did nothing.
    expect(clampZoom(1.37)).toBe(1.37);
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
  });

  it('steps to the stop on the side you asked for, from wherever you are', () => {
    expect(stepZoom(1.37, 1)).toBe(1.5);
    expect(stepZoom(1.37, -1)).toBe(1);
    // And from a stop, to the next one — not to the same one again.
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
  });

  it('does not walk off either end', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(canZoom(MAX_ZOOM, 1)).toBe(false);
    expect(canZoom(MIN_ZOOM, -1)).toBe(false);
    expect(canZoom(1.37, 1)).toBe(true);
    expect(canZoom(1.37, -1)).toBe(true);
    // A float that landed a hair under the ceiling is still the ceiling.
    expect(canZoom(2.999, 1)).toBe(false);
  });

  it('treats fit as the middle of the range, not the bottom', () => {
    // 100% is the width the container has, so there is a step OUT of it as well as
    // in — a plan wider than it is tall is read zoomed out.
    expect(FIT_ZOOM).toBe(1);
    expect(MIN_ZOOM).toBeLessThan(FIT_ZOOM);
  });
});

describe('zoomScroll', () => {
  it('keeps the point under the fingers under the fingers', () => {
    // A scroller 200px down, pinching a spot 100px below its top edge: that spot is
    // 300px into the content, and after doubling it is 600px in. To leave it where
    // the fingers are, the scroll has to end up at 500.
    const next = zoomScroll({ scroll: 200, pointInContent: 300, ratio: 2 });
    expect(next).toBe(500);
    expect(600 - next).toBe(100);
  });

  it('holds a horizontal spot too, because a zoomed page is wider than the screen', () => {
    expect(zoomScroll({ scroll: 120, pointInContent: 200, ratio: 1.5 })).toBe(220);
  });

  it('works from a NEGATIVE scroll, which is what RTL gives', () => {
    // This app is dir="rtl", and in an RTL scroller scrollLeft is 0 at the right
    // edge and runs negative leftwards. The old version measured from the viewport
    // and clamped at 0 — in RTL that is the END of the range, so every pinch pinned
    // the page to its right edge.
    expect(zoomScroll({ scroll: -120, pointInContent: 200, ratio: 1.5 })).toBe(-20);
    expect(zoomScroll({ scroll: -300, pointInContent: 400, ratio: 0.5 })).toBe(-500);
  });

  it('is a no-op at ratio 1', () => {
    expect(zoomScroll({ scroll: 40, pointInContent: 900, ratio: 1 })).toBe(40);
  });
});

describe('renderScale', () => {
  // The training plan: A4 landscape.
  const W = 842;
  const H = 595;

  it('gives the screen what it asked for when the canvas can hold it', () => {
    expect(renderScale(W, H, 1.4)).toBe(1.4);
  });

  it('caps rather than letting iOS hand back a blank canvas', () => {
    const scale = renderScale(W, H, 12);
    expect(scale).toBeLessThan(12);
    expect(W * scale * H * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
    expect(W * scale).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
  });

  it('caps on the long EDGE as well as on the area', () => {
    // A tall banner page: well inside the pixel budget, way past 4096 on one side.
    const scale = renderScale(400, 8000, 4);
    expect(400 * scale).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
    expect(8000 * scale).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
  });
});

describe('the viewer', () => {
  it('handles the pinch itself, on a listener that can prevent the default', () => {
    // A React onTouchMove prop cannot: React registers touchmove passively on the
    // root, so preventDefault is a no-op and the browser pans the scroller out from
    // under the gesture.
    expect(VIEWER).toMatch(/addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/);
    expect(VIEWER).toMatch(/e\.touches\.length !== 2/);
    expect(VIEWER).toMatch(/e\.preventDefault\(\)/);
    expect(VIEWER).toMatch(/touchAction: 'pan-x pan-y'/);
    // And a trackpad pinch, which arrives as a ctrl-wheel.
    expect(VIEWER).toMatch(/if \(!e\.ctrlKey\) return;/);
  });

  it('awaits the cancellation before drawing again', () => {
    // `cancel()` resolves asynchronously, so without the await the canvas is still
    // in use when the next zoom arrives and the page stays white.
    expect(VIEWER).toMatch(/running\.cancel\(\);\s*await running\.promise\.catch\(\(\) => \{\}\);/);
  });

  it('lets the layout lead and the bitmap follow', () => {
    // Otherwise a pinch rasterises on every frame of the gesture.
    expect(VIEWER).toMatch(/setRenderZoom\(zoom\)/);
    expect(VIEWER).toMatch(/fit \* renderZoom \* dpr/);
    // The holder and the canvas are sized from the same zoom, together.
    expect(VIEWER).toMatch(/style=\{\{ width: cssW, height: cssH \}\}/);
  });

  it('previews the pinch as a transform and commits it once', () => {
    // Driving `zoom` state from touchmove re-laid-out five canvases per frame and
    // raced React: touchmove is a continuous event, so the commit could land after
    // the frame that corrected the scroll.
    expect(VIEWER).toMatch(/content\.style\.transform = `scale\(\$\{scale\}\)`/);
    expect(VIEWER).toMatch(/clearPreview\(\);\s*commitZoom\(pinchZoom \* pinchScale/);
  });

  it('corrects the scroll in a layout effect, not a frame callback', () => {
    // The new scroll range exists only after React has committed the new page
    // sizes; in a rAF the assignment clamps against the old range and is lost.
    expect(VIEWER).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?pendingScroll\.current/);
    expect(VIEWER).not.toMatch(/requestAnimationFrame\(/);
  });

  it('lets the buttons be tapped twice in a row', () => {
    // MEASURED in a real Chromium at iPhone 13 size: without `touch-manipulation`
    // the browser keeps its own double-tap-to-zoom gesture on these buttons and
    // swallows the second of two fast taps — four taps on "+" moved the zoom one
    // step. With it, four taps land on 250%.
    const buttons = VIEWER.match(/touch-manipulation/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('will not mistake a scroll flick for a double tap', () => {
    // Two flicks that happen to end near each other used to jump the plan to 200%.
    expect(VIEWER).toMatch(/TAP_MAX_MS/);
    expect(VIEWER).toMatch(/TAP_SLOP_PX/);
    expect(VIEWER).toMatch(/if \(!touch \|\| moved \|\| Date\.now\(\) - downAt > TAP_MAX_MS\)/);
  });

  it('does not keep a zoom index anywhere', () => {
    expect(VIEWER).not.toMatch(/zoomIndex|ZOOM_STEPS|FIT_INDEX/);
  });
});
