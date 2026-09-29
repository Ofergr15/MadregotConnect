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
export type ShareHitMap = Partial<Record<SharePart, ShareBox>> & {
  /**
   * The logo's pieces one by one. On the route card the shoe sits under the
   * numbers, so the union of the marks covers the numbers too: outlining that, or
   * testing a tap against it, would hand the numbers to the logo.
   */
  logoPieces?: ShareBox[];
};

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

/** The bidi marks the renderer wraps numbers in, which the known title may or may not carry. */
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function isTextPart(text: string, known: Pick<HitMapKnown, 'title' | 'date'>): boolean {
  text = text.replace(BIDI_MARKS, '');
  const title = known.title?.replace(BIDI_MARKS, '').trim();
  return (!!title && text.includes(title)) || (!!known.date && text.includes(known.date));
}

/**
 * The part under a point, in card pixels. The logo and the text are tested before
 * the data because they sit inside its box on most views (the route card's title
 * is between the route and the numbers); anything else is the background.
 */
export function partAt(map: ShareHitMap, x: number, y: number, pad = 26): SharePart | 'background' {
  const hit = (b: ShareBox | undefined) => !!b && x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
  for (const k of ['logo', 'text', 'data'] as const) {
    if (k === 'logo' && map.logoPieces) { if (map.logoPieces.some(hit)) return k; continue; }
    if (hit(map[k])) return k;
  }
  return 'background';
}

type Pt = [number, number];

/**
 * A mark drawn as vector paths (the shoe) leaves no image call to recognise, so
 * its drawer names its own square as part of the logo through this slot. It is
 * there only while a recorder is running.
 */
export const LOGO_SLOT = Symbol('share-logo-slot');
export function markLogo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  (ctx as unknown as Record<symbol, ((x: number, y: number, w: number, h: number) => void) | undefined>)[LOGO_SLOT]?.(x, y, w, h);
}

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
    if (part === 'logo') (map.logoPieces ??= []).push(box);
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

  const slots = ctx as unknown as Record<symbol, unknown>;
  slots[LOGO_SLOT] = (x: number, y: number, w: number, h: number) => grow('logo', boxOf(rectPts(x, y, w, h)));

  return () => {
    delete slots[LOGO_SLOT];
    for (const name of patched) delete own[name];
    return map;
  };
}

export interface LabelRect { x: number; y: number; w: number; h: number }

const overlaps = (a: LabelRect, b: LabelRect, gap = 0) =>
  !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
const contains = (o: LabelRect, i: LabelRect) =>
  o.x <= i.x && o.y <= i.y && o.x + o.w >= i.x + i.w && o.y + o.h >= i.y + i.h;

/**
 * Where each part's label goes over the card, in screen pixels. A label sits just
 * outside its outline (above, beside, then below it), at the reading-start corner
 * first, and not on a label already placed, not on another part, and not past the
 * card's edge. The labels are the buttons that open the parts, so two of them
 * sharing a spot, or one lying over the title, would hide a part behind another
 * (feedback 2026-09-29). An outline that holds this part inside it (the route box
 * holds the title) is no obstacle: nothing near the title would be clear of it.
 * When no spot is clear of the parts, being clear of the other labels is enough.
 */
export function placeLabels(
  items: { key: string; box: LabelRect; w: number }[],
  card: { w: number; h: number },
  opts: { h: number; gap: number; rtl: boolean; obstacles?: LabelRect[] },
): Record<string, LabelRect> {
  const { h, gap, rtl } = opts;
  const placed: Record<string, LabelRect> = {};
  const taken: LabelRect[] = [];
  const inCard = (r: LabelRect) => r.x >= 2 && r.y >= 2 && r.x + r.w <= card.w - 2 && r.y + r.h <= card.h - 2;
  const fit = (r: LabelRect) => ({ ...r, x: Math.min(Math.max(r.x, 2), card.w - 2 - r.w) });
  for (const { key, box, w } of items) {
    const walls = [...items.map(i => i.box), ...(opts.obstacles ?? [])].filter(o => o !== box && !contains(o, box));
    const start = rtl ? box.x + box.w - w : box.x;
    const end = rtl ? box.x : box.x + box.w - w;
    const mid = box.x + (box.w - w) / 2;
    const midY = box.y + (box.h - h) / 2;
    const row = (y: number) => [start, end, mid].map(x => ({ x, y, w, h }));
    const tries = [
      ...row(box.y - h - 3),
      ...(rtl ? [box.x + box.w + 4, box.x - w - 4] : [box.x - w - 4, box.x + box.w + 4]).map(x => ({ x, y: midY, w, h })),
      ...row(box.y + box.h + 3),
      { x: start, y: box.y + 4, w, h },
    ];
    const freeOfLabels = (r: LabelRect) => inCard(r) && taken.every(o => !overlaps(r, o, gap));
    const free = (r: LabelRect) => freeOfLabels(r) && walls.every(o => !overlaps(r, o));
    const pick = tries.find(free) ?? tries.map(fit).find(free)
      ?? tries.find(freeOfLabels) ?? tries.map(fit).find(freeOfLabels) ?? fit(tries[0]!);
    placed[key] = pick;
    taken.push(pick);
  }
  return placed;
}
