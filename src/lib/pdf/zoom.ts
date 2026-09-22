/**
 * The zoom maths behind the plan PDF viewer, kept out of the component so it can
 * be tested without a canvas.
 *
 * Zoom is a CONTINUOUS number here, not an index into a ladder. It used to be an
 * index, which is exactly why pinching did nothing: a gesture produces 1.37, and
 * there was no state that could hold 1.37. The ladder survives as the stops the
 * +/- buttons jump between, so a thumb still lands somewhere predictable.
 *
 * 1 means fit-to-width — the width the container actually has — so the control
 * reads as "bigger or smaller than the page I'm looking at" rather than as an
 * absolute paper scale nobody can see.
 */

export const FIT_ZOOM = 1;
export const MIN_ZOOM = 0.75;

/**
 * Stops at 3x. Beyond that a landscape A4 exceeds the canvas size iOS Safari will
 * hand back, and an oversized canvas comes back blank rather than erroring.
 */
export const MAX_ZOOM = 3;

/** Where the +/- buttons land. The pinch is free to sit between them. */
export const ZOOM_STOPS = [0.75, 1, 1.5, 2, 2.5, 3] as const;

/** Float slack, so a zoom of 0.9999 counts as being ON the 1 stop. */
const EPS = 0.005;

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const atZoom = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

/**
 * The next stop above (`dir` 1) or below (`dir` -1) where we are now.
 *
 * From a pinched 1.37, "+" goes to 1.5 and "-" goes to 1 — the stop on that side,
 * not two stops away and not back to a remembered index. A ladder index could
 * only have answered this by throwing the gesture's value away.
 */
export const stepZoom = (zoom: number, dir: 1 | -1): number => {
  const stops = dir > 0 ? ZOOM_STOPS : [...ZOOM_STOPS].reverse();
  const next = stops.find((s) => (dir > 0 ? s > zoom + EPS : s < zoom - EPS));
  return clampZoom(next ?? zoom);
};

export const canZoom = (zoom: number, dir: 1 | -1): boolean =>
  dir > 0 ? zoom < MAX_ZOOM - EPS : zoom > MIN_ZOOM + EPS;

export interface ZoomScrollInput {
  /** The scroller's current `scrollLeft` or `scrollTop`. */
  scroll: number;
  /**
   * How far the point to hold still sits along that axis INSIDE the content, in
   * the content's own unscaled pixels — i.e. `touchX - contentRect.left`.
   */
  pointInContent: number;
  /** New zoom over old zoom. */
  ratio: number;
}

/**
 * Where to scroll so the point under the fingers stays under the fingers.
 *
 * Without it, zooming keeps the content's corner fixed: you pinch on Wednesday and
 * Wednesday slides off the screen, which is most of what "the zoom breaks it" feels
 * like in the hand.
 *
 * Measured from the CONTENT's own rect rather than from the viewport, which is what
 * makes it correct in RTL. This app is `dir="rtl"`, and in an RTL scroller
 * `scrollLeft` starts at 0 on the RIGHT edge and runs NEGATIVE leftwards. Any
 * formula phrased as "distance from the left edge of the viewport plus scrollLeft"
 * is therefore wrong on exactly the axis a zoomed-in page needs, and the old
 * version of this also clamped at 0 — which in RTL is the end of the range, so it
 * pinned the page to the right edge on every pinch.
 *
 * The result is deliberately NOT clamped: assigning an out-of-range scroll offset
 * is clamped by the browser, in the direction that element actually scrolls.
 */
export const zoomScroll = ({ scroll, pointInContent, ratio }: ZoomScrollInput): number =>
  scroll + pointInContent * (ratio - 1);

export interface ScrollAnchorInput {
  /** Distance from the content's START edge (top, or left) to the point, unscaled. */
  pointInContent: number;
  /** The content's current size along that axis, unscaled. */
  contentSize: number;
  /**
   * Whether the scrollable area grows away from the scroll origin — true for the
   * horizontal axis of a `dir="rtl"` scroller, false for everything else.
   */
  growsFromEnd: boolean;
}

/**
 * The same point, re-expressed against the edge the scroll box grows FROM.
 *
 * MEASURED, identically in Chromium and WebKit, on the real Program screen: at 200%
 * and scrolled to the middle of the range, one tap on "+" left the point that had
 * been in the centre of the screen 170px away from it — exactly the scroll offset.
 *
 * The reason is that an RTL scroller's overflow is added on the LEFT while
 * `scrollLeft: 0` stays pinned to the RIGHT. So when the pages get wider, the
 * content's left edge slides left by the whole of the growth at an unchanged
 * `scrollLeft`, and a correction phrased as a distance from that left edge is
 * short by precisely how far the box was scrolled. Measured from the right edge —
 * a negative number, the edge that does not move — it is right on both axes and in
 * both directions.
 */
export const scrollAnchor = ({
  pointInContent,
  contentSize,
  growsFromEnd,
}: ScrollAnchorInput): number => (growsFromEnd ? pointInContent - contentSize : pointInContent);

/** Hard ceiling on canvas pixels, well under the ~16.7M iOS gives up at. */
export const MAX_CANVAS_PIXELS = 8_000_000;
/** And on either dimension — older iPhones cap a canvas edge at 4096. */
export const MAX_CANVAS_EDGE = 4096;

/**
 * The scale to rasterise a page at: what the screen wants, or as much of it as a
 * canvas can hold.
 *
 * iOS returns a BLANK canvas rather than throwing when it is asked for one too
 * big, so this is the difference between a soft page and no page at all. Past the
 * ceiling the bitmap stops growing while the CSS size keeps going, so the page
 * goes soft instead of going missing.
 */
export const renderScale = (
  pageWidth: number,
  pageHeight: number,
  wanted: number,
): number => {
  const ceiling = Math.min(
    MAX_CANVAS_EDGE / pageWidth,
    MAX_CANVAS_EDGE / pageHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / (pageWidth * pageHeight)),
  );
  return Math.min(wanted, ceiling);
};
