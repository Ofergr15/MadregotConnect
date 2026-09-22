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

export interface AnchorInput {
  scrollLeft: number;
  scrollTop: number;
  /** The point to hold still, in the scroller's own coordinates. */
  anchorX: number;
  anchorY: number;
  /** New zoom over old zoom. */
  ratio: number;
}

/**
 * Where to scroll so that the point under the fingers stays under the fingers.
 *
 * Without this, zooming keeps the top-left corner fixed: you pinch on Wednesday
 * and Wednesday slides off the screen, which is most of what "the zoom breaks it"
 * feels like on a phone. Content scales linearly with zoom, so the content
 * coordinate under the anchor is `(scroll + anchor)`, and after the scale it wants
 * to be at the same `anchor` again.
 *
 * Negative results are clamped: the scroller cannot scroll past its own start, and
 * a page narrower than the viewport is centred by the layout rather than scrolled.
 */
export const zoomAnchor = ({
  scrollLeft,
  scrollTop,
  anchorX,
  anchorY,
  ratio,
}: AnchorInput): { scrollLeft: number; scrollTop: number } => ({
  scrollLeft: Math.max(0, (scrollLeft + anchorX) * ratio - anchorX),
  scrollTop: Math.max(0, (scrollTop + anchorY) * ratio - anchorY),
});

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
