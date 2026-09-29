/**
 * WHERE ON THE CARD EACH PART WAS DRAWN, SO THE SHEET CAN MAKE THE CARD TAPPABLE.
 *
 * The share editor opens the logo's options when the logo is tapped, the text's
 * when the title is, and the chart's (or the numbers') when those are. Six views
 * put those parts in six different places, and a view moves them again when a
 * number is turned off or the title is hidden — so the places are not written down
 * anywhere. They are read off the drawing itself: while the layout runs, the calls
 * on THIS card's context are watched and sorted into three boxes.
 *
 *  · logo — an image the renderer names as a club mark (the three white files, or
 *           the tinted copy of one).
 *  · text — a line of type that carries the run's title or its date.
 *  · data — everything else that is drawn: the route, the bars, the numbers.
 *
 * Nothing that covers most of the card counts (the gradient, the scrim, a photo):
 * those are the background, which is what a tap on an empty spot opens.
 *
 * Only the one context is patched, as own properties, and they are deleted again
 * afterwards. The prototype is never touched, because the thumbnails of the other
 * views are being drawn on other canvases at the same moment.
 */

export type SharePart = 'logo' | 'text' | 'data';
export interface ShareBox { x0: number; y0: number; x1: number; y1: number }
export type ShareHitMap = Partial<Record<SharePart, ShareBox>>;

export interface HitMapKnown {
  isMark: (src: unknown) => boolean;
  title: string | null;
  date: string | null;
  width: number;
  height: number;
}

/** Anything larger than this share of the card is background, not a part. */
const BACKGROUND_SHARE = 0.45;

export function unionBox(a: ShareBox | undefined, b: ShareBox): ShareBox {
  if (!a) return b;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function isTextPart(text: string, known: Pick<HitMapKnown, 'title' | 'date'>): boolean {
  const title = known.title?.trim();
  return (!!title && text.includes(title)) || (!!known.date && text.includes(known.date));
}

/**
 * The part under a point, in card pixels. The logo and the text are tested before
 * the data because they sit inside its box on most views (the route card's title
 * is between the route and the numbers); anything else is the background.
 */
export function partAt(map: ShareHitMap, x: number, y: number, pad = 26): SharePart | 'background' {
  for (const k of ['logo', 'text', 'data'] as const) {
    const b = map[k];
    if (b && x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad) return k;
  }
  return 'background';
}

type Pt = [number, number];

/** Starts watching `ctx`; the returned function stops and hands back the boxes. */
export function recordHitMap(ctx: CanvasRenderingContext2D, known: HitMapKnown): () => ShareHitMap {
  const map: ShareHitMap = {};
  const limit = known.width * known.height * BACKGROUND_SHARE;
  let path: Pt[] = [];
  const own = ctx as unknown as Record<string, unknown>;
  const patched: string[] = [];

  const toCard = (x: number, y: number): Pt => {
    const m = ctx.getTransform();
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  };
  const boxOf = (pts: Pt[]): ShareBox | null => {
    if (pts.length === 0) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const grow = (part: SharePart, box: ShareBox | null) => {
    if (!box) return;
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    if (area > limit) return;
    map[part] = unionBox(map[part], box);
  };
  const rectPts = (x: number, y: number, w: number, h: number): Pt[] =>
    [toCard(x, y), toCard(x + w, y), toCard(x, y + h), toCard(x + w, y + h)];

  const wrap = (name: string, before: (...args: never[]) => void) => {
    const original = (ctx as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    if (typeof original !== 'function') return;
    patched.push(name);
    own[name] = (...args: unknown[]) => {
      (before as (...a: unknown[]) => void)(...args);
      return original.apply(ctx, args);
    };
  };

  wrap('beginPath', () => { path = []; });
  wrap('moveTo', (x: number, y: number) => { path.push(toCard(x, y)); });
  wrap('lineTo', (x: number, y: number) => { path.push(toCard(x, y)); });
  wrap('quadraticCurveTo', (_cx: number, _cy: number, x: number, y: number) => { path.push(toCard(x, y)); });
  wrap('bezierCurveTo', (_a: number, _b: number, _c: number, _d: number, x: number, y: number) => { path.push(toCard(x, y)); });
  wrap('rect', (x: number, y: number, w: number, h: number) => { path.push(...rectPts(x, y, w, h)); });
  wrap('roundRect', (x: number, y: number, w: number, h: number) => { path.push(...rectPts(x, y, w, h)); });
  wrap('arc', (x: number, y: number, r: number) => { path.push(...rectPts(x - r, y - r, 2 * r, 2 * r)); });
  // A Path2D argument carries points this recorder never saw; those shapes (the
  // shoe, the heart-rate curve) sit inside parts that are already boxed.
  wrap('fill', (arg?: unknown) => { if (!(arg && typeof arg === 'object')) grow('data', boxOf(path)); });
  wrap('stroke', (arg?: unknown) => { if (!(arg && typeof arg === 'object')) grow('data', boxOf(path)); });
  wrap('fillRect', (x: number, y: number, w: number, h: number) => { grow('data', boxOf(rectPts(x, y, w, h))); });
  wrap('fillText', (text: string, x: number, y: number, maxWidth?: number) => {
    if (!text || !text.trim()) return;
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 20);
    let w = ctx.measureText(text).width;
    if (maxWidth != null) w = Math.min(w, maxWidth);
    const rtl = ctx.direction === 'rtl';
    const align = ctx.textAlign;
    const left = align === 'center' ? x - w / 2
      : align === 'right' || (align === 'start' && rtl) || (align === 'end' && !rtl) ? x - w
        : x;
    const top = ctx.textBaseline === 'middle' ? y - size / 2
      : ctx.textBaseline === 'top' || ctx.textBaseline === 'hanging' ? y
        : y - size * 0.85;
    grow(isTextPart(text, known) ? 'text' : 'data', boxOf(rectPts(left, top, w, size)));
  });
  wrap('drawImage', (img: unknown, ...a: number[]) => {
    const source = img as { width?: number; height?: number };
    const [x, y, w, h] = a.length >= 8 ? a.slice(4) : a.length >= 4 ? a : [a[0], a[1], source.width ?? 0, source.height ?? 0];
    grow(known.isMark(img) ? 'logo' : 'data', boxOf(rectPts(x, y, w, h)));
  });

  return () => {
    for (const name of patched) delete own[name];
    return map;
  };
}
