/**
 * Renders a 1080×1920 Instagram/Facebook story card for a run — entirely in the
 * browser, on a canvas.
 *
 * Client-side rather than server-side (Satori / @vercel/og) for two reasons: the
 * athlete's background photo never leaves the device, and Hebrew RTL layout is
 * fully under our control instead of at the mercy of a text shaper we can't debug.
 *
 * The card is OPAQUE by default. Strava's transparent story overlay works because
 * a native app can hand Instagram a sticker via `com.instagram.sharedSticker.*`
 * (iOS pasteboard) or an ADD_TO_STORY intent (Android) — neither is reachable from
 * a PWA. Routed through navigator.share(), Instagram treats the PNG as a photo and
 * may flatten alpha, so by default we composite our own background and control the
 * result. `transparent` opts into the save-then-add-as-photo-sticker flow instead.
 */

import type { FeedItem, FeedActivity } from './project';

export const STORY_W = 1080;
export const STORY_H = 1920;

const MARGIN = 80;
const BRAND = '#1525FF';
/** The square club badge, with "EST. 2022" set inside it. */
const LOGO_SRC = '/images/logo-white.png';
/** The MADREGOT wordmark. Used by the seven newer views in place of the badge. */
const WORDMARK_SRC = '/images/wordmark-white.png';
/** The club's stairs mark — `sideBySide` uses it where the other views use a route. */
const STAIRS_SRC = '/images/stairs-white.png';

/**
 * Layout variants, mirroring the way Strava offers several story styles.
 *
 * The first three are the originals; the seven after them were added in the
 * ten-view pass. Nothing was retired in that pass — an athlete who liked the old
 * `card` sticker still has it, and the set is a superset rather than a redesign.
 */
export type ShareTemplate =
  | 'classic'
  | 'card'
  | 'minimal'
  | 'photo'
  | 'route'
  | 'routeOnly'
  | 'statsBar'
  | 'fullStats'
  | 'sideBySide'
  | 'bigNumbers';

/** The three that shipped first, drawn exactly as they always were. */
export const LEGACY_TEMPLATE_KEYS: ShareTemplate[] = ['classic', 'card', 'minimal'];

/** The newer set: centred type, the wordmark instead of the badge. */
export const NEW_TEMPLATE_KEYS: ShareTemplate[] = [
  'photo',
  'route',
  'routeOnly',
  'statsBar',
  'fullStats',
  'sideBySide',
  'bigNumbers',
];

/** Rail order: the new band first, then the originals. */
export const SHARE_TEMPLATE_KEYS: ShareTemplate[] = [...NEW_TEMPLATE_KEYS, ...LEGACY_TEMPLATE_KEYS];

export const DEFAULT_SHARE_TEMPLATE: ShareTemplate = 'route';

/**
 * Views built around the GPS trace, which have nothing to show without one.
 *
 * The three original layouts are deliberately not in here: each already checks for
 * a route and shrinks, so a treadmill run gets a shorter card rather than a hole,
 * and hiding them would take choices away from exactly the runs that have fewest.
 */
const ROUTE_REQUIRED: ShareTemplate[] = ['route', 'routeOnly', 'bigNumbers'];

/** Views that can sit on the athlete's own photo. */
const PHOTO_CAPABLE: ShareTemplate[] = ['classic', 'card', 'minimal', 'photo'];

export function hasRouteTrace(act: Pick<FeedActivity, 'routePreview'>): boolean {
  return !!act.routePreview && act.routePreview.length > 2;
}

export function supportsPhoto(template: ShareTemplate): boolean {
  return PHOTO_CAPABLE.includes(template);
}

/**
 * `photo` is the one view that always composites its own background, so there is
 * no sticker version of it — everything else can export on transparent alpha.
 */
export function supportsTransparent(template: ShareTemplate): boolean {
  return template !== 'photo';
}

/** The views worth offering for this run, in rail order. */
export function templatesForActivity(act: Pick<FeedActivity, 'routePreview'>): ShareTemplate[] {
  const routed = hasRouteTrace(act);
  return SHARE_TEMPLATE_KEYS.filter(t => routed || !ROUTE_REQUIRED.includes(t));
}

/**
 * The accent applies to **the run's own line and nothing else** — the route, or the
 * stairs mark that stands in for it. The wordmark, the badge, the shoe and every
 * piece of type stay white in both schemes, so the brand never changes colour.
 */
export type ShareAccent = 'white' | 'orange';

export const SHARE_ACCENT_KEYS: ShareAccent[] = ['white', 'orange'];

export const ACCENT_HEX: Record<ShareAccent, string> = {
  white: '#ffffff',
  orange: '#FF5315',
};

/**
 * Strings and locale for the rendered card.
 *
 * Passed in rather than read from next-intl: this module draws to a canvas and is
 * deliberately not a React component, so it has no access to hooks. The caller
 * (which does) supplies them.
 */
export interface ShareI18n {
  km: string;
  perKm: string;
  pace: string;
  time: string;
  hr: string;
  /** Labels the newer views need, which the original three never printed. */
  distance: string;
  elevation: string;
  calories: string;
  /** Unit for elevation gain. */
  metres: string;
}

export interface ShareCardOptions {
  /** Athlete-chosen background photo. Falls back to a brand gradient. */
  background?: Blob | null;
  /**
   * Render the overlay alone on a transparent canvas, exported as PNG.
   *
   * Instagram's story editor can't paste an image from the clipboard — its sticker
   * tray reads the camera roll — so the flow this serves is: save the PNG, then add
   * it in Stories via the photo sticker, which does preserve alpha. Text gets a
   * heavier shadow here because the background is whatever the athlete picks.
   */
  transparent?: boolean;
  /** Defaults to 'classic' — the caller passes DEFAULT_SHARE_TEMPLATE for new sheets. */
  template?: ShareTemplate;
  /** Colour of the route line. Defaults to white. */
  accent?: ShareAccent;
  /**
   * Draw the run's own title ("Italian medio", "Long run") on the card.
   *
   * Defaults to true. Athletes name their runs for themselves — the name can be
   * a private joke, a coach's shorthand or just noise — so the sheet lets them
   * drop it without renaming the activity. The 'minimal' template has never had
   * a title, so this is a no-op there.
   */
  showTitle?: boolean;
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * next/font generates a hashed family name (`__Heebo_abc123`), so a literal
 * "Heebo" in a canvas font string silently falls back to the system sans. Reading
 * the resolved stack off <body> gets the real name.
 */
function resolveFontStack(): string {
  if (typeof window === 'undefined') return 'sans-serif';
  const family = getComputedStyle(document.body).fontFamily;
  return family || 'sans-serif';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** ctx.roundRect is Safari 16+ only; this keeps older iOS working. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Scale-to-fill with a centre crop, the way a story background should behave. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  iw: number,
  ih: number,
) {
  const scale = Math.max(STORY_W / iw, STORY_H / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(img, (STORY_W - w) / 2, (STORY_H - h) / 2, w, h);
}

function drawBrandGradient(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
  g.addColorStop(0, '#1e1b4b');
  g.addColorStop(0.55, BRAND);
  g.addColorStop(1, '#0f172a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
}

/**
 * Dark scrim under the text. Without it, white type over a bright photo (sky, snow,
 * a sunlit road) is unreadable — the single most common way these cards fail.
 */
function drawScrim(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, STORY_H * 0.35, 0, STORY_H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0.88)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Slight top darkening so the route line never fights a bright sky.
  const top = ctx.createLinearGradient(0, 0, 0, STORY_H * 0.3);
  top.addColorStop(0, 'rgba(0,0,0,0.45)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, STORY_W, STORY_H * 0.3);
}

/**
 * Recolours a white-on-transparent PNG.
 *
 * The club marks ship as white artwork only and the orange is derived here, so
 * there is never a second set of files to keep in step with the first.
 */
function tint(img: HTMLImageElement, color: string): CanvasImageSource {
  if (color.toLowerCase() === '#ffffff') return img;
  const off = document.createElement('canvas');
  off.width = img.width;
  off.height = img.height;
  const g = off.getContext('2d');
  if (!g) return img;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, off.width, off.height);
  return off;
}

/** The route polyline, fitted into a box with its aspect ratio preserved. */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  points: Array<{ lat: number; lng: number }>,
  box: { x: number; y: number; w: number; h: number },
  lineWidth = 10,
  color = '#ffffff',
) {
  if (points.length < 2) return;

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 1e-6;
  const lngRange = maxLng - minLng || 1e-6;

  // Longitude degrees shrink with latitude; without this correction routes look
  // stretched east-west. Matches how the run actually looked on a map.
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const spanX = lngRange * lngScale;
  const spanY = latRange;

  const scale = Math.min(box.w / spanX, box.h / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const originX = box.x + (box.w - drawW) / 2;
  const originY = box.y + (box.h - drawH) / 2;

  const pts = points.map(p => ({
    x: originX + ((p.lng - minLng) * lngScale) * scale,
    // Invert Y so north is up.
    y: originY + (maxLat - p.lat) * scale,
  }));

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  ctx.shadowBlur = 0;
  // Start (green) and finish (red) caps, same language as the feed minimap.
  const capR = Math.max(8, lineWidth * 1.4);
  for (const [pt, color] of [[pts[0], '#22c55e'], [pts[pts.length - 1], '#ef4444']] as const) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, capR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();
}

interface Stat {
  value: string;
  label: string;
  /**
   * Drawn as its own run, to the right of the value.
   *
   * Not concatenated into `value`, because "22.37 ק״מ" is a mixed-direction string
   * and the bidi algorithm reorders it — a pace came out as `ק"מ/ 4:41`, with the
   * slash on the wrong end. Two positioned runs can't be reordered.
   */
  unit?: string;
}

/** The secondary stats, in the order they read best. Pace and HR may be absent. */
function secondaryStats(act: FeedActivity, i18n: ShareI18n): Stat[] {
  const out: Stat[] = [];
  if (act.averagePace) out.push({ value: formatPace(act.averagePace), label: i18n.pace });
  out.push({ value: formatDuration(act.duration), label: i18n.time });
  if (act.averageHr) out.push({ value: `${Math.round(act.averageHr)}`, label: i18n.hr });
  return out;
}

function distanceKm(act: FeedActivity): string {
  return (act.distance / 1000).toFixed(2).replace(/\.?0+$/, '');
}

/*
 * The card carries the run, nothing else: the athlete's name, their group and the
 * date of the run are all deliberately left off every template. Whoever posts this
 * to a story is already identified by the account they post from, when they ran is
 * implied by when they posted, and the group is nobody else's business.
 */

/** Distance, pace, time — the three every newer view leads with. */
function coreStats(act: FeedActivity, i18n: ShareI18n): Stat[] {
  const out: Stat[] = [{ value: distanceKm(act), unit: i18n.km, label: i18n.distance }];
  if (act.averagePace) {
    out.push({ value: formatPace(act.averagePace), unit: i18n.perKm, label: i18n.pace });
  }
  out.push({ value: formatDuration(act.duration), label: i18n.time });
  return out;
}

/**
 * Up to six. Elevation, calories and heart rate are not on every activity — a
 * treadmill run or a watch worn without a strap simply yields a shorter grid,
 * which is why `fullStats` lays itself out from the length rather than assuming 6.
 */
function extendedStats(act: FeedActivity, i18n: ShareI18n): Stat[] {
  const out = coreStats(act, i18n);
  if (act.elevationGain != null) {
    out.push({ value: `${Math.round(act.elevationGain)}`, unit: i18n.metres, label: i18n.elevation });
  }
  if (act.calories != null) {
    out.push({ value: Math.round(act.calories).toLocaleString('en-US'), label: i18n.calories });
  }
  if (act.averageHr) out.push({ value: `${Math.round(act.averageHr)}`, label: i18n.hr });
  return out;
}

interface LayoutCtx {
  ctx: CanvasRenderingContext2D;
  font: string;
  act: FeedActivity;
  logo: HTMLImageElement | null;
  /** Wordmark and stairs mark; null if either failed to load. */
  wordmark: HTMLImageElement | null;
  stairs: HTMLImageElement | null;
  shadow: string;
  shadowBlur: number;
  /** Resolved accent hex — route line only. */
  accent: string;
  i18n: ShareI18n;
  showTitle: boolean;
}

/*
 * ── Geometry for the seven newer views ──────────────────────────────────────
 * They were drawn in a 383×681 mockup, so every number below is that mockup's
 * value through `p()`. Keeping the conversion explicit means a tweak in the
 * mockup is a one-to-one edit here instead of a re-derivation.
 */
const MOCK_W = 383;
const p = (n: number) => Math.round((n * STORY_W) / MOCK_W);
const CX = STORY_W / 2;

/** Centred run title, if the athlete kept it. Returns whether it drew. */
function drawTitle(c: LayoutCtx, baseline: number): boolean {
  const { ctx, font, act, showTitle } = c;
  if (!act.activityName || !showTitle) return false;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.font = `700 ${p(19)}px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(act.activityName, CX, baseline);
  return true;
}

/**
 * A number and its unit, positioned rather than concatenated, with the unit set
 * smaller and to the right. Shrinks to fit `maxWidth` instead of overflowing —
 * the longest values (a Hebrew unit after a five-character pace) are what would
 * have run off the edge of `bigNumbers`.
 */
function drawValueWithUnit(
  c: LayoutCtx,
  s: Stat,
  x: number,
  baseline: number,
  size: number,
  align: 'center' | 'left',
  maxWidth: number,
) {
  const { ctx, font } = c;
  // Digits and a slash only keep their order in an LTR run.
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';

  const measure = (px: number) => {
    ctx.font = `700 ${px}px ${font}`;
    const vW = ctx.measureText(s.value).width;
    const uPx = Math.round(px * 0.62);
    ctx.font = `700 ${uPx}px ${font}`;
    const uW = s.unit ? ctx.measureText(s.unit).width : 0;
    const gap = s.unit ? px * 0.2 : 0;
    return { vW, uW, uPx, gap, total: vW + gap + uW };
  };

  let m = measure(size);
  let px = size;
  if (m.total > maxWidth) {
    px = Math.floor(size * (maxWidth / m.total));
    m = measure(px);
  }

  const startX = align === 'center' ? x - m.total / 2 : x;
  ctx.font = `700 ${px}px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(s.value, startX, baseline);
  if (s.unit) {
    ctx.font = `700 ${m.uPx}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(s.unit, startX + m.vW + m.gap, baseline);
  }
}

/** One label-over-value pair. `x` is the centre, or the left edge when left-aligned. */
function drawStat(
  c: LayoutCtx,
  s: Stat,
  x: number,
  labelBaseline: number,
  align: 'center' | 'left' = 'center',
  maxWidth = p(112),
) {
  const { ctx, font } = c;
  // Labels are single-script Hebrew, so they take the locale's own direction.
  ctx.direction = 'rtl';
  ctx.textAlign = align === 'center' ? 'center' : 'left';
  ctx.font = `700 ${p(14)}px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(s.label, x, labelBaseline);
  drawValueWithUnit(c, s, x, labelBaseline + p(24), p(22), align, maxWidth);
}

/** Spreads stats evenly across [left, right], each centred in its own column. */
function drawStatRow(c: LayoutCtx, stats: Stat[], left: number, right: number, labelBaseline: number) {
  const colW = (right - left) / stats.length;
  stats.forEach((s, i) =>
    drawStat(c, s, left + colW * (i + 0.5), labelBaseline, 'center', colW - p(8)),
  );
}

/** The wordmark, centred. Never accented. Returns its drawn height. */
function drawWordmark(c: LayoutCtx, top: number, width: number, cx = CX): number {
  const { ctx, wordmark } = c;
  if (!wordmark) return 0;
  const h = (wordmark.height / wordmark.width) * width;
  ctx.globalAlpha = 0.95;
  ctx.drawImage(wordmark, cx - width / 2, top, width, h);
  ctx.globalAlpha = 1;
  return h;
}

/**
 * The club's shoe glyph, the same outline the app uses in the nav — inlined as
 * path data because a 24px SVG scaled to 100px on a canvas needs the vector, and
 * shipping one more PNG for a three-stroke mark isn't worth the request.
 */
const SHOE_PATHS = [
  'M2 16.5h13.2c2.6 0 4.4-.7 5.9-2.2.7-.7.9-1.7.5-2.5-.5-1-1.6-1.4-2.6-1.1l-3.3 1-4.4-4.2c-.6-.6-1.6-.6-2.2 0L7.6 9.4 2 12.2z',
  'M2 16.5v1.8c0 .7.6 1.2 1.3 1.2h15.4',
  'M9.6 10.4l2.2 2.1',
  'M12.4 8.9l2.2 2.1',
];

function drawShoe(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  if (typeof Path2D === 'undefined') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of SHOE_PATHS) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/**
 * Bottom-anchored stats with the logo centred beneath, over the full frame.
 * The stack builds upward from the bottom margin so a run with no GPS simply
 * omits the route rather than leaving a hole.
 */
function layoutClassic({ ctx, font, act, logo, shadow, shadowBlur, accent, i18n, showTitle }: LayoutCtx) {
  const right = STORY_W - MARGIN;
  let y = STORY_H - MARGIN;

  if (logo) {
    // The logo is a square badge with fine internal type ("EST. 2022"), not a
    // wordmark — below ~140px on a 1080-wide canvas that inner text turns to mush.
    const logoH = 178;
    const logoW = (logo.width / logo.height) * logoH;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(logo, (STORY_W - logoW) / 2, y - logoH, logoW, logoH);
    ctx.globalAlpha = 1;
    // The date used to sit between the logo and the divider; without it the gap
    // is set here instead so the rule doesn't crowd the badge.
    y -= logoH + 120;
  } else {
    y -= 24;
  }

  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  y -= 76;

  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;
  const secondary = secondaryStats(act, i18n);
  const colW = (STORY_W - MARGIN * 2) / secondary.length;
  secondary.forEach((s, i) => {
    // Columns run right-to-left to match the Hebrew reading order.
    const cx = right - i * colW;
    ctx.font = `700 64px ${font}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.value, cx, y);
    ctx.font = `500 32px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(s.label, cx, y + 44);
  });
  y -= 96;

  ctx.font = `500 48px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(i18n.km, right, y);
  const unitW = ctx.measureText(i18n.km).width;

  ctx.font = `800 180px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(distanceKm(act), right - unitW - 24, y);
  y -= 200;

  if (act.activityName && showTitle) {
    ctx.font = `600 44px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(act.activityName, right, y);
    y -= 72;
  }
  ctx.shadowBlur = 0;

  if (act.routePreview && act.routePreview.length > 2) {
    const boxTop = STORY_H * 0.16;
    const available = y - boxTop - 48;
    if (available > 160) {
      drawRoute(
        ctx,
        act.routePreview,
        { x: MARGIN, y: boxTop, w: STORY_W - MARGIN * 2, h: available },
        10,
        accent,
      );
    }
  }
}

/**
 * A self-contained panel: logo top-right, stats along the bottom.
 *
 * Because the panel carries its own background it's the one template that reads
 * as a proper sticker over an arbitrary story background, so it's also the best
 * pairing with `transparent`.
 */
function layoutCard({ ctx, font, act, logo, shadow, shadowBlur, accent, i18n, showTitle }: LayoutCtx) {
  const hasRoute = !!act.routePreview && act.routePreview.length > 2;

  const PAD = 56;
  const cardX = 70;
  const cardW = STORY_W - cardX * 2;
  const logoH = logo ? 112 : 0;
  const routeH = hasRoute ? 380 : 0;
  const titleH = act.activityName && showTitle ? 62 : 0;

  // Height is summed from the blocks that actually render, so a run with no GPS
  // yields a shorter panel instead of an empty gap.
  const cardH =
    PAD +
    logoH +
    (routeH ? 36 + routeH : 0) +
    36 +
    titleH +
    150 + // hero distance block
    28 +
    2 + // divider
    36 +
    110 + // stats block
    PAD;

  // Sits slightly below centre: Instagram's own header crowds the top of a story.
  const cardY = Math.max(140, (STORY_H - cardH) / 2 + 90);
  const right = cardX + cardW - PAD;

  // Panel. Opaque enough to carry white text over any background.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, 56);
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  ctx.fill();
  ctx.restore();

  roundRectPath(ctx, cardX, cardY, cardW, cardH, 56);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();

  let y = cardY + PAD;

  // Logo, top-right inside the panel.
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(logo, right - logoW, y, logoW, logoH);
    ctx.globalAlpha = 1;
    y += logoH;
  }

  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';

  if (hasRoute) {
    y += 36;
    drawRoute(ctx, act.routePreview!, { x: cardX + PAD, y, w: cardW - PAD * 2, h: routeH }, 8, accent);
    y += routeH;
  }

  y += 36;

  if (act.activityName && showTitle) {
    ctx.font = `600 40px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(act.activityName, right, y + 40);
    y += titleH;
  }

  // Hero distance
  const heroBaseline = y + 130;
  ctx.font = `500 44px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(i18n.km, right, heroBaseline);
  const unitW = ctx.measureText(i18n.km).width;
  ctx.font = `800 150px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(distanceKm(act), right - unitW - 20, heroBaseline);
  y += 150 + 28;

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + PAD, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  y += 36;

  // Stats along the bottom of the panel.
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur / 2;
  const secondary = secondaryStats(act, i18n);
  const colW = (cardW - PAD * 2) / secondary.length;
  secondary.forEach((s, i) => {
    const cx = right - i * colW;
    ctx.font = `700 58px ${font}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.value, cx, y + 58);
    ctx.font = `500 30px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(s.label, cx, y + 100);
  });
  ctx.shadowBlur = 0;
}

/** Just the number. Centred, lots of air — the best pairing with a strong photo. */
function layoutMinimal({ ctx, font, act, logo, shadow, shadowBlur, i18n }: LayoutCtx) {
  const cx = STORY_W / 2;

  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  const heroBaseline = STORY_H * 0.55;

  ctx.font = `800 260px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(distanceKm(act), cx, heroBaseline);

  ctx.font = `600 56px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(i18n.km, cx, heroBaseline + 80);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 120, heroBaseline + 140);
  ctx.lineTo(cx + 120, heroBaseline + 140);
  ctx.stroke();

  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;
  const pace = act.averagePace ? `${formatPace(act.averagePace)} ${i18n.perKm}` : null;
  const line = [pace, formatDuration(act.duration)].filter(Boolean).join('   ·   ');
  ctx.font = `600 48px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(line, cx, heroBaseline + 220);
  ctx.shadowBlur = 0;

  if (logo) {
    const logoH = 148;
    const logoW = (logo.width / logo.height) * logoH;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, cx - logoW / 2, STORY_H - MARGIN - logoH, logoW, logoH);
    ctx.globalAlpha = 1;
  }
}

/*
 * ── The seven newer views ────────────────────────────────────────────────────
 * Shared vocabulary, so they read as one family: type is centred rather than
 * right-aligned, the mark is the wordmark rather than the square badge, and the
 * stats are label-over-value pairs at one of two sizes.
 */

/** `classic` restyled: centred stats and the wordmark, over the athlete's photo. */
function layoutPhoto(c: LayoutCtx) {
  const { ctx, shadow, shadowBlur, act, i18n } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  drawTitle(c, p(461));

  const wmW = p(124);
  const wmTop = p(478);
  const wmH = drawWordmark(c, wmTop, wmW);
  drawShoe(ctx, CX - wmW / 2 - p(9) - p(36), wmTop + (wmH - p(36)) / 2, p(36));

  drawStatRow(c, coreStats(act, i18n), p(22), STORY_W - p(22), p(552));
  ctx.shadowBlur = 0;
}

/** The new default: the run's real shape, the mark, and three stats under it. */
function layoutRoute(c: LayoutCtx) {
  const { ctx, act, accent, shadow, shadowBlur, i18n } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';

  if (act.routePreview) {
    drawRoute(ctx, act.routePreview, { x: CX - p(151), y: p(170), w: p(302), h: p(155) }, 10, accent);
  }

  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;
  drawTitle(c, p(375));
  drawWordmark(c, p(412), p(132));
  drawStatRow(c, coreStats(act, i18n), p(22), STORY_W - p(22), p(488));
  ctx.shadowBlur = 0;
  drawShoe(ctx, CX - p(18), p(545), p(36));
}

/** Just the shape and the mark, no numbers. The quietest sticker in the set. */
function layoutRouteOnly(c: LayoutCtx) {
  const { ctx, act, accent, shadow, shadowBlur } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';

  if (act.routePreview) {
    drawRoute(ctx, act.routePreview, { x: CX - p(151), y: p(246), w: p(302), h: p(155) }, 10, accent);
  }

  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;
  drawTitle(c, p(451));
  drawWordmark(c, p(492), p(132));
  ctx.shadowBlur = 0;
}

/**
 * Mark and three stats, no route at all — so this is the one view a treadmill run
 * can always fall back to without anything looking as though it went missing.
 */
function layoutStatsBar(c: LayoutCtx) {
  const { ctx, act, shadow, shadowBlur, i18n } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  drawTitle(c, p(265));
  const wmW = p(140);
  const wmTop = p(292);
  drawWordmark(c, wmTop, wmW);
  drawShoe(ctx, CX - wmW / 2 - p(48), wmTop + p(9), p(36));

  drawStatRow(c, coreStats(act, i18n), p(18), STORY_W - p(18), p(368));
  ctx.shadowBlur = 0;
}

/** Six stats in a grid. Elevation, calories and HR aren't on every activity. */
function layoutFullStats(c: LayoutCtx) {
  const { ctx, act, shadow, shadowBlur, i18n } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  drawTitle(c, p(237));
  const wmW = p(140);
  const wmTop = p(264);
  drawWordmark(c, wmTop, wmW);
  drawShoe(ctx, CX - wmW / 2 - p(48), wmTop + p(9), p(36));

  const stats = extendedStats(act, i18n);
  const left = p(18);
  const right = STORY_W - p(18);
  const cols = Math.min(3, stats.length);
  const colW = (right - left) / cols;
  const rowPitch = p(56);
  stats.forEach((s, i) => {
    const cx = left + colW * ((i % cols) + 0.5);
    drawStat(c, s, cx, p(342) + Math.floor(i / cols) * rowPitch, 'center', colW - p(8));
  });
  ctx.shadowBlur = 0;
}

/** The stairs mark instead of a route, with the stats stacked beside it. */
function layoutSideBySide(c: LayoutCtx) {
  const { ctx, stairs, accent, act, shadow, shadowBlur, i18n } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  drawTitle(c, p(209));

  // The stairs stand in for the route here, so they take the accent with it.
  if (stairs) {
    ctx.shadowBlur = 0;
    ctx.drawImage(tint(stairs, accent), p(24), p(248), p(180), p(177));
    ctx.shadowColor = shadow;
    ctx.shadowBlur = shadowBlur;
  }

  const colX = p(214);
  const wmW = p(132);
  const wmH = drawWordmark(c, p(240), wmW, colX + wmW / 2);

  let labelBaseline = p(240) + wmH + p(16) + p(14);
  const colWidth = STORY_W - p(10) - colX;
  for (const s of coreStats(act, i18n)) {
    drawStat(c, s, colX, labelBaseline, 'left', colWidth);
    labelBaseline += p(55);
  }
  ctx.shadowBlur = 0;
}

/** Three stats as large as they go, a small route and a big logo. Loud, for a PR. */
function layoutBigNumbers(c: LayoutCtx) {
  const { ctx, font, act, accent, shadow, shadowBlur, i18n } = c;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  const stats = coreStats(act, i18n);
  let top = p(56);
  for (const s of stats) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.font = `700 ${p(23)}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(s.label, CX, top + p(23));
    drawValueWithUnit(c, s, CX, top + p(78), p(52), 'center', STORY_W - p(36));
    top += p(113);
  }
  ctx.shadowBlur = 0;

  if (act.routePreview) {
    drawRoute(ctx, act.routePreview, { x: CX - p(79), y: p(406), w: p(158), h: p(81) }, 8, accent);
  }
  drawWordmark(c, p(522), p(190));
}

const LAYOUTS: Record<ShareTemplate, (c: LayoutCtx) => void> = {
  classic: layoutClassic,
  card: layoutCard,
  minimal: layoutMinimal,
  photo: layoutPhoto,
  route: layoutRoute,
  routeOnly: layoutRouteOnly,
  statsBar: layoutStatsBar,
  fullStats: layoutFullStats,
  sideBySide: layoutSideBySide,
  bigNumbers: layoutBigNumbers,
};

/** Renders the card and returns a blob ready for navigator.share(). */
export async function renderShareCard(
  item: FeedItem,
  i18n: ShareI18n,
  opts: ShareCardOptions = {},
): Promise<Blob> {
  const act = item.activity;
  if (!act) throw new Error('Share card requires an activity');

  // Otherwise the first paint uses a fallback face and the text is subtly wrong.
  await document.fonts.ready;
  const font = resolveFontStack();

  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const template = opts.template ?? 'classic';
  // `photo` composites its own background by definition; asking for it transparent
  // would leave the frame empty.
  const transparent = !!opts.transparent && supportsTransparent(template);

  // ── Background ────────────────────────────────────────────────────────────
  if (!transparent) {
    let drewPhoto = false;
    if (opts.background && supportsPhoto(template)) {
      try {
        const bitmap = await createImageBitmap(opts.background);
        drawCover(ctx, bitmap, bitmap.width, bitmap.height);
        bitmap.close?.();
        drewPhoto = true;
      } catch {
        // Unreadable photo (e.g. a HEIC the browser can't decode) — fall through
        // to the gradient rather than failing the whole share.
      }
    }
    if (!drewPhoto) drawBrandGradient(ctx);
    // The scrim exists to keep white type readable over an unknown photo. The
    // card template brings its own panel, and over our own flat gradient the
    // scrim only mutes the background for no legibility gain — so the newer
    // views take it just when there is a real photo underneath.
    // `photo` is defined by its background, so it is scrimmed either way — over the
    // fallback gradient its type would otherwise sit on the brightest blue we have.
    const onGradient = (LEGACY_TEMPLATE_KEYS.includes(template) && template !== 'card') || template === 'photo';
    if (drewPhoto ? template !== 'card' : onGradient) drawScrim(ctx);
  }

  // The badge is only needed by the original three, the wordmark and stairs only
  // by the newer ones — but a failed load must never fail the share, so all three
  // resolve to null instead of throwing.
  const [logo, wordmark, stairs] = await Promise.all([
    loadImage(LOGO_SRC).catch(() => null),
    loadImage(WORDMARK_SRC).catch(() => null),
    template === 'sideBySide' ? loadImage(STAIRS_SRC).catch(() => null) : Promise.resolve(null),
  ]);

  // Over an unknown background the only thing keeping white text readable is the
  // shadow, so the transparent variant leans on it harder.
  LAYOUTS[template]({
    ctx,
    font,
    act,
    logo,
    wordmark,
    stairs,
    shadow: transparent ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.45)',
    shadowBlur: transparent ? 28 : 16,
    accent: ACCENT_HEX[opts.accent ?? 'white'],
    i18n,
    showTitle: opts.showTitle ?? true,
  });

  // JPEG has no alpha channel — a transparent card exported as JPEG comes out with
  // a black background, so the variant dictates the format.
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Failed to encode share image'))),
      transparent ? 'image/png' : 'image/jpeg',
      transparent ? undefined : 0.92,
    );
  });
}

/**
 * Hands the card to the OS share sheet, falling back to a download.
 *
 * The fallback matters: Web Share with files is unsupported on desktop Firefox and
 * every desktop browser except Safari, and a silent no-op would look like a bug.
 */
export async function shareCard(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // The user dismissing the sheet is not an error worth surfacing.
      if ((err as Error)?.name === 'AbortError') return 'shared';
      // Anything else (e.g. NotAllowedError) falls through to the download path.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
