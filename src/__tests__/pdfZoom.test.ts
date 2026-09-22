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
  zoomAnchor,
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

describe('zoomAnchor', () => {
  it('keeps the point under the fingers under the fingers', () => {
    // Pinching on a spot 100px into a scroller already 200px down: that spot is at
    // content 300, which after doubling is 600, and it has to end up at 100 again.
    const s = zoomAnchor({ scrollLeft: 0, scrollTop: 200, anchorX: 0, anchorY: 100, ratio: 2 });
    expect(s.scrollTop).toBe(500);
    expect(500 + 100).toBe(600);
  });

  it('holds a horizontal spot too, because a zoomed page is wider than the screen', () => {
    const s = zoomAnchor({ scrollLeft: 120, scrollTop: 0, anchorX: 80, anchorY: 0, ratio: 1.5 });
    expect(s.scrollLeft).toBe(220);
  });

  it('never asks for a negative scroll', () => {
    // Zooming out past the start: the layout centres what is narrower than the
    // viewport, and a negative scrollLeft is silently clamped by the browser anyway.
    const s = zoomAnchor({ scrollLeft: 0, scrollTop: 0, anchorX: 100, anchorY: 100, ratio: 0.5 });
    expect(s.scrollLeft).toBe(0);
    expect(s.scrollTop).toBe(0);
  });

  it('is a no-op at ratio 1', () => {
    const s = zoomAnchor({ scrollLeft: 40, scrollTop: 90, anchorX: 10, anchorY: 20, ratio: 1 });
    expect(s).toEqual({ scrollLeft: 40, scrollTop: 90 });
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
    expect(VIEWER).toMatch(/renderZoom \* dpr|fit \* renderZoom \* dpr/);
    // The holder and the canvas are sized from the LIVE zoom, together.
    expect(VIEWER).toMatch(/style=\{\{ width: cssW, height: cssH \}\}/);
  });

  it('does not keep a zoom index anywhere', () => {
    expect(VIEWER).not.toMatch(/zoomIndex|ZOOM_STEPS|FIT_INDEX/);
  });
});
