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

import { formatActivityTime } from '@/lib/utils';
import type { FeedItem, FeedActivity } from './project';
import { markLogo, recordHitMap, type ShareHitMap } from '@/lib/share/hit-map';

export const STORY_W = 1080;
export const STORY_H = 1920;

const MARGIN = 80;
const BRAND = '#1525FF';
/** The square club badge, with "EST. 2022" set inside it. */
const LOGO_SRC = '/images/logo-white.png';
/** The MADREGOT wordmark. Used by the seven newer views in place of the badge. */
const WORDMARK_SRC = '/images/wordmark-white.png';
/**
 * The club's stairs mark — `sideBySide` uses it where the other views use a route,
 * and `splits` as its only logo, beside the heading.
 */
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
  | 'bigNumbers'
  | 'splits';

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
  'splits',
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
const PHOTO_CAPABLE: ShareTemplate[] = [
  'classic', 'card', 'minimal', 'photo', 'route', 'routeOnly', 'splits',
];

/** A view with nothing to draw without GPS — the sheet greys it and says so. */
export function requiresRoute(template: ShareTemplate): boolean {
  return ROUTE_REQUIRED.includes(template);
}

/** `splits` IS the per-kilometre chart, so without two splits it has nothing to draw. */
export function requiresSplits(template: ShareTemplate): boolean {
  return template === 'splits';
}

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

/** The views that draw the club's shoe beside the logo, the ones it can be taken off. */
export function supportsShoe(template: ShareTemplate): boolean {
  return template === 'photo' || template === 'route' || template === 'statsBar' || template === 'fullStats';
}

/**
 * Which templates have room under their content for the bars and the verdict.
 *
 * Exactly one of them, and the reason is measurable rather than aesthetic. The
 * frame is 383×681 design units and a story's bottom fifth is covered by
 * Instagram's own reply bar, so the usable floor is about 590. `route` already draws
 * its shoe mark down to 581 and `photo` its stats to ~576; `fullStats` ends its grid
 * at ~430 and has 160 units spare. Lifting the route block to make room would move
 * a card athletes already recognise, to fit a block they have not asked to see yet.
 *
 * The sheet greys the two toggles on the other frames and says this in one line,
 * rather than accepting the tap and drawing nothing.
 */
const FOOTER_CAPABLE: ShareTemplate[] = ['fullStats'];

export function supportsFooter(template: ShareTemplate): boolean {
  return FOOTER_CAPABLE.includes(template);
}

/** The views worth offering for this run, in rail order. */
export function templatesForActivity(act: Pick<FeedActivity, 'routePreview'>): ShareTemplate[] {
  const routed = hasRouteTrace(act);
  return SHARE_TEMPLATE_KEYS.filter(t => routed || !ROUTE_REQUIRED.includes(t));
}

/**
 * Every kilometre gets its own row up to this many; the rows shrink to fit instead.
 * It was 21, with pairs above it, and a 25 km run came out as 2, 4, 6, 8 — the
 * athlete read that as rows hidden (feedback 2026-09-29), and they were right. 50
 * covers a marathon and then some; only an ultra falls back to pairs.
 */
export const SPLITS_MAX_ROWS = 50;

/**
 * The accent applies to **the run's own line and nothing else** — the route, or the
 * stairs mark that stands in for it. The wordmark, the badge, the shoe and every
 * piece of type stay white in both schemes, so the brand never changes colour.
 */
export type ShareAccent = 'white' | 'orange';

/**
 * Which of the club's three marks a card carries: the round badge, the MADREGOT
 * lettering, or the stairs. Every view has always had exactly one, fixed — the
 * badge on classic/card/minimal, the lettering on route and the stats bar, the
 * stairs on KM Splits — and that stays the default. Choosing one only swaps what
 * is drawn IN that view's slot: the slot keeps its place and its box, and the mark
 * is fitted inside it, so no layout moves when the athlete changes the logo.
 */
export type ShareBrand = 'badge' | 'wordmark' | 'stairs';
export const SHARE_BRAND_KEYS: ShareBrand[] = ['badge', 'wordmark', 'stairs'];

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
  /** Label for the start-of-run clock time — "Started" / "התחלה". */
  start: string;
  /** Labels the newer views need, which the original three never printed. */
  distance: string;
  elevation: string;
  calories: string;
  /** Unit for elevation gain. */
  metres: string;
  /**
   * Units for the duration — "1:13:26 ש׳" / "43:26 דק׳".
   *
   * A bare clock string is ambiguous on a card with no other context: "43:26" is
   * read as forty-three hours as readily as forty-three minutes, and the newer
   * views print it at the same size as the distance, with nothing around it to
   * settle the question.
   */
  hoursShort: string;
  minutesShort: string;
  /** Title over the per-kilometre bars — "ק״מ אחרי ק״מ" / "KM Splits". */
  splits: string;
  /** Title over the lap chart — "מקטעים" / "Splits". */
  segments: string;
  /**
   * The one thing a reader cannot guess about the pace bars.
   *
   * On a chart of kilometres, taller means more. On a chart of PACES, taller has to
   * mean faster — a bar chart where the best kilometre is the shortest reads as a
   * bad run. Saying so in four words is cheaper than a second axis.
   */
  fastest: string;
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
  /**
   * Draw the run's start time as a fourth stat ("Started 6:01").
   *
   * Defaults to true. Requested against Garmin's own share image, which carries
   * the clock time; only the TIME is drawn, never the date — see the note above
   * `secondaryStats` for why the date stays off. A no-op on 'minimal', whose whole
   * point is the bare number.
   */
  showStartTime?: boolean;
  /**
   * Print the run's date beside its name. Only `splits` has a line for it, and it
   * defaults to on there — the list of kilometres is otherwise undated.
   */
  showDate?: boolean;
  /** The logo to draw in the view's logo slot; the view's own when absent. */
  brand?: ShareBrand;
  /** The shoe beside the logo on the views that have one (`supportsShoe`). Defaults to on. */
  showShoe?: boolean;
  /** KM Splits / segments: a dashed line at the run's average pace across the bars. */
  avgLine?: boolean;
  /** Segments: the laps' heart rate as a grey area behind the bars, as Strava draws it. */
  hrLine?: boolean;
  /**
   * Segments: the chart as the share editor draws it — the watch's heart rate
   * (`hrTrace`) or lagged lap plateaus in place of the round curve, and a pace
   * scale that labels the fastest lap and steps in half minutes. Only the editor
   * asks for it, and the editor is super-user only, so the club keeps the chart
   * it has until this is rolled out (feedback 2026-09-29).
   */
  editorChart?: boolean;
  /**
   * Segments: time runs left to right on a Hebrew card too, the way Strava and the
   * watch draw it; the pace scale stays on the right. Super user only until he
   * rolls it out ("the workout here is reversed", 2026-10-02).
   */
  timeLtr?: boolean;
  /**
   * Handed where the logo, the text and the data were drawn, in card pixels, so the
   * share editor can open each part's options when that part is tapped
   * (`lib/share/hit-map.ts`). Nothing is recorded when it is absent.
   */
  onHitMap?: (map: ShareHitMap) => void;
  /**
   * What the KM Splits view charts: each kilometre (the default), or each lap the
   * watch pressed (`segments`). Falls back to kilometres when the run has no
   * `lapBands`.
   */
  splitMode?: 'km' | 'segments';
  /**
   * Which numbers go on the card, chosen by the athlete in the sheet.
   *
   * Defaults to distance/pace/time, which is what the newer views printed before
   * the chips existed — so a caller that doesn't pass this gets exactly the card
   * it got before. The legacy three (`classic`, `card`, `minimal`) ignore it: they
   * draw `secondaryStats` and have their own fixed row.
   */
  metrics?: WorkoutMetricKey[];
  /**
   * The run of bars along the bottom — per kilometre here, per day on the weekly
   * card, drawn by the same function. Absent by default.
   */
  bars?: ShareBars | null;
  /**
   * How the session went against the day's plan. Absent by default, and that is a
   * decision rather than an oversight — see `ShareVerdict`.
   */
  verdict?: ShareVerdict | null;
}

/**
 * A run of bars with a scale but no axis.
 *
 * ONE function draws these on both cards: per kilometre for a workout, per day for
 * a week. They are the same picture of the same kind of thing — a sequence with a
 * shape — and two implementations would drift on bar width, on what a zero looks
 * like, and on which end the first bar goes.
 *
 * There is no gridline and no y-axis, because a story is read in about a second by
 * somebody who does not know the athlete's normal week. What the reader gets is the
 * SHAPE, the two ends of the sequence, and one bar picked out; a scale they would
 * have to study is a scale they will not study.
 */
export interface ShareBars {
  /** In reading order: the first value goes where the eye starts. */
  values: number[];
  /** The one bar drawn at full strength — the fastest km, the biggest day. */
  highlight?: number | null;
  /** The two ends of the sequence, e.g. ['1', '11'] or ['13.09', '19.09']. */
  axis: [string, string];
  /** The metric's own name, printed above the bars. */
  label: string;
  /** One short line under the title, where the chart needs a word of warning. */
  hint?: string;
  /**
   * Lower is better, so the tallest bar is the smallest number.
   *
   * True for pace and false for distance. It also changes the FLOOR: paces cluster
   * inside a minute of each other, so a zero-based scale would draw seven bars of
   * nearly identical height and say nothing — the band is relative, with the
   * slowest kilometre kept visible rather than flattened to the baseline.
   */
  inverted?: boolean;
}

/**
 * The plan verdict as the card prints it.
 *
 * `color` is passed in rather than derived here so the card cannot invent a fifth
 * palette: the one table in `lib/plan-execution/verdict.ts` already decides what
 * every direction looks like on all three surfaces that show it, and a direction
 * that is blue in the app and orange on the card is worse than no colour at all.
 *
 * `text` is the direction in the CARD'S language, not the app's, for the same
 * reason every other string on the card is — see `lib/share/card-text.ts`.
 */
export interface ShareVerdict {
  text: string;
  /** 0–100. Null when the session was graded without a score. */
  score: number | null;
  color: string;
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
export function resolveFontStack(): string {
  if (typeof window === 'undefined') return 'sans-serif';
  const family = getComputedStyle(document.body).fontFamily;
  return family || 'sans-serif';
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** ctx.roundRect is Safari 16+ only; this keeps older iOS working. */
export function roundRectPath(
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
export function drawCover(
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

/**
 * THE one bar drawer, used by the workout card and the weekly card.
 *
 * Everything that differs between the two is an argument: the values, which end the
 * eye starts at, and whether taller means more or faster. `box` is the whole block
 * INCLUDING its title line and the two end labels, so a caller only has to know
 * where the block starts and how tall it is allowed to be.
 *
 * Two details that are easy to get wrong and hard to notice afterwards:
 *  · every bar gets a faint full-height track behind it, so a rest day reads as an
 *    empty slot in the week rather than as a missing bar;
 *  · in RTL the first value is drawn on the RIGHT. The bars are a sequence in time,
 *    and a Hebrew reader starts a sequence where they start a sentence.
 */
export function drawShareBars(
  ctx: CanvasRenderingContext2D,
  font: string,
  bars: ShareBars,
  box: { x: number; y: number; w: number; h: number },
  opts: {
    rtl: boolean;
    /** Colour of the highlighted bar. The rest are always plain white at 58%. */
    accent?: string;
    labelPx: number;
    axisPx: number;
    radius: number;
  },
) {
  const { values, axis, label, hint } = bars;
  const positive = values.filter(v => v > 0);
  // Two bars is the least that is a shape rather than a fact already on the card.
  if (values.length < 2 || positive.length === 0) return;

  const { rtl, labelPx, axisPx, radius } = opts;
  // A drop shadow on a filled rectangle turns the whole block muddy, so the block
  // is drawn flat regardless of what the layout around it set.
  ctx.save();
  ctx.shadowBlur = 0;

  const startEdge = rtl ? box.x + box.w : box.x;
  const endEdge = rtl ? box.x : box.x + box.w;

  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.font = `700 ${labelPx}px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(label, startEdge, box.y + labelPx);
  if (hint) {
    ctx.textAlign = rtl ? 'left' : 'right';
    ctx.font = `500 ${axisPx}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(hint, endEdge, box.y + labelPx);
  }

  const bandTop = box.y + labelPx + Math.round(labelPx * 0.55);
  const bandBottom = box.y + box.h - Math.round(axisPx * 1.9);
  const bandH = Math.max(0, bandBottom - bandTop);

  const hi = Math.max(...positive);
  const lo = Math.min(...positive);
  // See `inverted`: a relative band for paces, a zero-based one for distances.
  const floor = bars.inverted ? 0.3 : 0;
  const scoreOf = (v: number) => {
    if (hi === lo) return 1;
    return bars.inverted ? (hi - v) / (hi - lo) : v / hi;
  };

  const pitch = box.w / values.length;
  // Capped against the BAND as well as the pitch. Seven days across the weekly
  // panel gives each bar a 115px slot, and a bar wider than it is tall reads as a
  // box with a fill level rather than as a height to compare — which is the one
  // thing the block exists to show. One rule for both cards, no per-card width.
  const barW = Math.max(2, Math.min(pitch * 0.54, bandH * 0.42));
  values.forEach((v, i) => {
    const cx = rtl ? box.x + box.w - pitch * (i + 0.5) : box.x + pitch * (i + 0.5);
    const x = cx - barW / 2;
    // Faint on purpose: the track is there so a rest day reads as an empty slot
    // instead of as absence, and anything brighter competes with the bars.
    roundRectPath(ctx, x, bandTop, barW, bandH, radius);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    if (v <= 0) return;
    const h = Math.max(radius * 2, (floor + (1 - floor) * scoreOf(v)) * bandH);
    roundRectPath(ctx, x, bandBottom - h, barW, h, radius);
    ctx.fillStyle = i === bars.highlight ? (opts.accent ?? '#ffffff') : 'rgba(255,255,255,0.58)';
    ctx.fill();
  });

  // Digits only, so the pair reads in the same order in both languages; which end
  // each one is pinned to is what carries the direction.
  ctx.direction = 'ltr';
  ctx.font = `600 ${axisPx}px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(axis[0], startEdge, box.y + box.h);
  ctx.textAlign = rtl ? 'left' : 'right';
  ctx.fillText(axis[1], endEdge, box.y + box.h);

  ctx.restore();
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
// The recoloured copies are still the club's marks, for the hit map's purposes.
const TINTED = new WeakSet<object>();

function tint(img: HTMLImageElement, color: string): CanvasImageSource {
  if (color.toLowerCase() === '#ffffff') return img;
  const off = document.createElement('canvas');
  TINTED.add(off);
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

/**
 * The secondary stats, in the order they read best. Pace and HR may be absent.
 *
 * The start time rides in this row rather than as a line of its own on purpose:
 * a value-over-label column draws the number and the Hebrew label as two separate
 * fillTexts, so there is no "התחלה 6:01" string for the bidi algorithm to reorder
 * into "6:01 התחלה" (the same trap `drawHeroDistance` exists to dodge). It goes
 * LAST so pace/time/HR keep the positions athletes already know.
 *
 * `formatActivityTime` reads the stored timestamp by its UTC parts, which is what
 * gives the athlete's own clock — see the note on `parseActivityInstant`. A card
 * rendered in another timezone therefore still says when they actually ran.
 */
export function secondaryStats(act: FeedActivity, i18n: ShareI18n, showStartTime = false): Stat[] {
  const out: Stat[] = [];
  if (act.averagePace) out.push({ value: formatPace(act.averagePace), label: i18n.pace });
  out.push({ value: formatDuration(act.duration), label: i18n.time });
  if (act.averageHr) out.push({ value: `${Math.round(act.averageHr)}`, label: i18n.hr });
  if (showStartTime && act.startTime) {
    out.push({ value: formatActivityTime(act.startTime), label: i18n.start });
  }
  return out;
}

function distanceKm(act: FeedActivity): string {
  return (act.distance / 1000).toFixed(2).replace(/\.?0+$/, '');
}

/*
 * The card carries the run, nothing else: the athlete's name, their group and the
 * DATE of the run are all deliberately left off every template. Whoever posts this
 * to a story is already identified by the account they post from, which day they
 * ran is implied by when they posted, and the group is nobody else's business.
 *
 * The start TIME is the one exception, added on request against Garmin's share
 * image: "was this the 5am one or the evening one" is part of the run's character
 * in a way the calendar date isn't, and it says nothing about the athlete.
 */

/**
 * WHICH numbers can go on a workout card, and how each one prints.
 *
 * One table, read by three things that used to disagree: the chips in the sheet,
 * the preview, and the exported image. The weekly card has had this since it
 * shipped (see `lib/reports/week-share.ts` and the note at the top of it) and the
 * workout card had a fixed set per template instead — which is exactly why the two
 * sheets could not be one sheet.
 *
 * The ORDER here is the order they print, not the order the athlete tapped: the
 * card is a report, and a report whose columns move around between two shares is
 * harder to read than one with a column the athlete didn't want. `start` is last
 * for the same reason it was appended last to `secondaryStats` — the stats athletes
 * already know keep their positions.
 */
export type WorkoutMetricKey = 'km' | 'pace' | 'time' | 'elev' | 'cal' | 'hr' | 'start';

export const WORKOUT_METRIC_KEYS: WorkoutMetricKey[] = [
  'km', 'pace', 'time', 'elev', 'cal', 'hr', 'start',
];

const WORKOUT_METRICS: Record<WorkoutMetricKey, {
  /** Does this run carry the metric at all. A dash on a card is worse than a gap. */
  has: (act: FeedActivity) => boolean;
  stat: (act: FeedActivity, i18n: ShareI18n) => Stat;
}> = {
  km: {
    has: act => act.distance > 0,
    stat: (act, i18n) => ({ value: distanceKm(act), unit: i18n.km, label: i18n.distance }),
  },
  pace: {
    has: act => !!act.averagePace,
    stat: (act, i18n) => ({ value: formatPace(act.averagePace!), unit: i18n.perKm, label: i18n.pace }),
  },
  time: {
    has: act => act.duration > 0,
    // Whichever unit the clock string's leading number is actually in.
    stat: (act, i18n) => ({
      value: formatDuration(act.duration),
      unit: act.duration >= 3600 ? i18n.hoursShort : i18n.minutesShort,
      label: i18n.time,
    }),
  },
  elev: {
    has: act => act.elevationGain != null,
    stat: (act, i18n) => ({
      value: `${Math.round(act.elevationGain!)}`, unit: i18n.metres, label: i18n.elevation,
    }),
  },
  cal: {
    has: act => act.calories != null,
    stat: (act, i18n) => ({
      value: Math.round(act.calories!).toLocaleString('en-US'), label: i18n.calories,
    }),
  },
  hr: {
    has: act => !!act.averageHr,
    stat: (act, i18n) => ({ value: `${Math.round(act.averageHr!)}`, label: i18n.hr }),
  },
  start: {
    has: act => !!act.startTime,
    stat: (act, i18n) => ({ value: formatActivityTime(act.startTime), label: i18n.start }),
  },
};

/** The metrics this run can actually print, in card order. */
export function availableWorkoutMetrics(act: FeedActivity): WorkoutMetricKey[] {
  return WORKOUT_METRIC_KEYS.filter(key => WORKOUT_METRICS[key].has(act));
}

/** One metric as it appears on the card — the chips print this, not their own copy. */
export function workoutMetricStat(
  act: FeedActivity,
  i18n: ShareI18n,
  key: WorkoutMetricKey,
): Stat | null {
  return WORKOUT_METRICS[key].has(act) ? WORKOUT_METRICS[key].stat(act, i18n) : null;
}

/**
 * The chosen metrics in the athlete's order, skipping any this run doesn't carry.
 *
 * The order used to be fixed (card order, whatever order the chips were tapped),
 * because the sheet never showed an order. The editor lists the picked numbers in
 * a row that can be dragged, so the order is now the athlete's: what they see in
 * that row is what the card prints, left to right.
 */
export function workoutStats(
  act: FeedActivity,
  i18n: ShareI18n,
  keys: WorkoutMetricKey[],
): Stat[] {
  return keys
    .filter((key, i) => WORKOUT_METRIC_KEYS.includes(key) && keys.indexOf(key) === i)
    .map(key => workoutMetricStat(act, i18n, key))
    .filter((s): s is Stat => !!s);
}

/**
 * How many WHOLE kilometres this run has a split for.
 *
 * Whole ones only. The last split of an 11.4 km run covers 400 m, and its pace is
 * a different quantity from the eleven before it — a sprint finish over 400 m would
 * otherwise set the scale for the entire chart and squash every real kilometre into
 * the bottom third. `paceBands` is also null outright for a run nobody has opened
 * (it is read from the cached splits) and for an athlete who has hidden their pace,
 * which is why the chip has to be able to grey out.
 */
export function paceBandCount(act: Pick<FeedActivity, 'paceBands' | 'distance'>): number {
  if (!act.paceBands || act.paceBands.length < 2) return 0;
  return Math.min(act.paceBands.length, Math.floor(act.distance / 1000));
}

/** The per-kilometre bars for a run, or null when it has no usable splits. */
export function workoutPaceBars(act: FeedActivity, i18n: ShareI18n): ShareBars | null {
  const n = paceBandCount(act);
  if (n < 2) return null;
  const values = act.paceBands!.slice(0, n);
  // The fastest kilometre is the one worth pointing at, and it is the one the
  // athlete cannot read off the average pace already on the card.
  let best = 0;
  values.forEach((v, i) => {
    if (v > 0 && (values[best] <= 0 || v < values[best])) best = i;
  });
  return {
    values,
    highlight: best,
    axis: ['1', String(n)],
    label: i18n.splits,
    hint: i18n.fastest,
    inverted: true,
  };
}

/** The default set: distance, pace, time — what every newer view always led with. */
export const DEFAULT_WORKOUT_METRICS: WorkoutMetricKey[] = ['km', 'pace', 'time'];

/**
 * What a layout actually draws.
 *
 * Capped rather than wrapped: the row layouts are built for three columns across
 * the frame and the grid for six, so the cap is a property of the FRAME. The sheet
 * knows the same numbers (`frameCapacity` in `lib/share/sheet-model.ts`) and stops
 * offering a fourth chip, so in practice nothing is ever silently dropped here —
 * this slice is the renderer refusing to be the place that first finds out.
 */
function pickedStats(c: LayoutCtx, max: number): Stat[] {
  return workoutStats(c.act, c.i18n, c.metrics).slice(0, max);
}

interface LayoutCtx {
  ctx: CanvasRenderingContext2D;
  font: string;
  act: FeedActivity;
  logo: HTMLImageElement | null;
  /** Wordmark and stairs mark; null if either failed to load. */
  wordmark: HTMLImageElement | null;
  stairs: HTMLImageElement | null;
  /** The athlete's pick for the logo slot, loaded; null keeps each view's own. */
  brand: HTMLImageElement | null;
  avgLine: boolean;
  hrLine: boolean;
  editorChart: boolean;
  timeLtr: boolean;
  splitMode: 'km' | 'segments';
  shadow: string;
  shadowBlur: number;
  /** Resolved accent hex — route line only. */
  accent: string;
  i18n: ShareI18n;
  showTitle: boolean;
  showStartTime: boolean;
  showDate: boolean;
  showShoe: boolean;
  /** The chosen numbers, in card order — see WORKOUT_METRICS. */
  metrics: WorkoutMetricKey[];
  /** The per-kilometre bars, when the athlete turned them on. */
  bars: ShareBars | null;
  /** The plan verdict, when the athlete turned it on. Never on by itself. */
  verdict: ShareVerdict | null;
}

/**
 * The hero distance: a big number with its unit beside it.
 *
 * The unit goes to the LEFT of the number and the number sits flush right, which
 * is the opposite of what an LTR eye expects and the whole point of this helper.
 * Reported on the story sticker: "יחידות הק״מ נמצאות בצד ימין כמו באנגלית וזה
 * כתוב בעברית". Canvas doesn't reorder anything for us — `direction = 'rtl'` only
 * shapes a single fillText — so drawing the unit first at `right` (as this used to)
 * physically places it where the reader's eye lands first, and "15.05 ק״מ" is read
 * as "ק״מ 15.05". Two fillTexts rather than one string because a number spliced
 * into Hebrew text is a bidi coin flip (see the note on canvas units in the share
 * card work); measuring the number and stepping left of it is deterministic.
 *
 * `align: 'center'` centres the number-and-unit PAIR on `x` — not the number, which
 * would leave the pair visually pushed right by the width of the unit. Both draws
 * are right-aligned internally either way; `textAlign` is restored.
 */
function drawHeroDistance(
  ctx: CanvasRenderingContext2D,
  act: FeedActivity,
  i18n: ShareI18n,
  opts: {
    font: string;
    /** Right edge of the pair, or its centre line when `align` is 'center'. */
    x: number;
    baseline: number;
    numberPx: number;
    unitPx: number;
    gap?: number;
    align?: 'right' | 'center';
  },
) {
  const { font, x, baseline, numberPx, unitPx, gap = 24, align = 'right' } = opts;
  const value = distanceKm(act);

  ctx.font = `800 ${numberPx}px ${font}`;
  const numberW = ctx.measureText(value).width;
  ctx.font = `500 ${unitPx}px ${font}`;
  const unitW = ctx.measureText(i18n.km).width;

  const right = align === 'center' ? x + (numberW + gap + unitW) / 2 : x;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = 'right';

  ctx.font = `800 ${numberPx}px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(value, right, baseline);

  ctx.font = `500 ${unitPx}px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(i18n.km, right - numberW - gap, baseline);

  ctx.textAlign = previousAlign;
}

/**
 * The row of secondary stats (pace / time / HR), spread across the full width.
 *
 * Each stat is CENTRED in its own column. It used to be right-aligned AT the
 * column boundary, which pinned all three hard against the right of the frame and
 * left a dead gutter on the left — reported as "הלוגו של המדרגות לא ממורכז
 * בתמונה", though measuring the reporter's own screenshot showed the logo dead
 * centre (360.0 of 720) and this row at 426.0: the logo was fine, the content
 * above it was the thing off-centre.
 *
 * Columns are still allocated right-to-left so the reading order is unchanged.
 * `textAlign` is set here and left as the caller had it.
 */
function drawSecondaryRow(
  ctx: CanvasRenderingContext2D,
  stats: Stat[],
  opts: {
    font: string;
    left: number;
    right: number;
    baseline: number;
    valuePx: number;
    labelPx: number;
    labelGap: number;
    labelColor?: string;
  },
) {
  const { font, left, right, baseline, valuePx, labelPx, labelGap } = opts;
  const labelColor = opts.labelColor ?? 'rgba(255,255,255,0.65)';
  const previousAlign = ctx.textAlign;
  const colW = (right - left) / stats.length;

  ctx.textAlign = 'center';
  stats.forEach((s, i) => {
    const cx = right - i * colW - colW / 2;
    ctx.font = `700 ${valuePx}px ${font}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.value, cx, baseline);
    ctx.font = `500 ${labelPx}px ${font}`;
    ctx.fillStyle = labelColor;
    ctx.fillText(s.label, cx, baseline + labelGap);
  });
  ctx.textAlign = previousAlign;
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

  // WHICH SIDE the unit goes on is a property of the unit's own script, not of
  // the app's locale: "16.3 km" puts it on the right, and the same phrase in
  // Hebrew — "16.3 ק״מ" — puts it on the left, because that is where the word
  // AFTER the number lands when the line reads right-to-left. Drawing it on the
  // right in Hebrew reads as "ק״מ 16.3", i.e. unit first, which is how the card
  // ended up saying the equivalent of "km 16.3".
  const unitFirst = !!s.unit && /[\u0590-\u05FF]/.test(s.unit);

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
  const valueX = unitFirst ? startX + m.uW + m.gap : startX;
  ctx.font = `700 ${px}px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(s.value, valueX, baseline);
  if (s.unit) {
    ctx.font = `700 ${m.uPx}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(s.unit, unitFirst ? startX : startX + m.vW + m.gap, baseline);
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

/*
 * ── The footer: the bars, then the verdict ───────────────────────────────────
 * Both live below the numbers, in that order, and both are off unless the athlete
 * turned them on. The order is not arbitrary: the bars are a description of the run
 * and the verdict is a judgement of it, so the judgement goes last and closest to
 * the edge of the frame — the only line on any card that says the run was not what
 * it should have been reads as a footnote rather than as a headline.
 */

/** Title line + bars + the two end labels, in design units. */
const BARS_H = 96;
const FOOTER_GAP = 8;
const PILL_H = 34;

/**
 * The verdict, as a pill.
 *
 * A pill rather than a line of type because it is the ONE judgement on the card and
 * it has to be legible as a separate kind of statement from the numbers around it.
 * The colour dot carries the direction — "62%" alone cannot tell you whether the
 * session was too fast or too slow, which is the whole point of showing a direction
 * at all (see `ExecutionDirection`).
 */
function drawVerdictPill(c: LayoutCtx, top: number): number {
  const { ctx, font, verdict } = c;
  if (!verdict) return 0;

  const h = p(PILL_H);
  const padX = p(15);
  const dot = p(11);
  const gap = p(8);
  const textPx = p(15);

  // The dot leads and the score trails, in the READING order of the words in the
  // pill — a Hebrew verdict with its dot on the left is read score-first, which
  // puts the number the athlete did not ask to lead with at the front of the line.
  // Same script test as `drawValueWithUnit`, for the same reason.
  const rtl = /[֐-׿]/.test(verdict.text);

  ctx.save();
  ctx.shadowBlur = 0;
  // Measured under the same direction it is drawn under, or the width is wrong by
  // a hair and the pill sits off-centre.
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'left';
  ctx.font = `700 ${textPx}px ${font}`;
  const textW = ctx.measureText(verdict.text).width;
  const score = verdict.score === null ? null : `${Math.round(verdict.score)}%`;
  ctx.font = `800 ${textPx}px ${font}`;
  const scoreW = score ? ctx.measureText(score).width : 0;

  const w = padX * 2 + dot + gap + textW + (score ? gap + scoreW : 0);
  const x = CX - w / 2;
  roundRectPath(ctx, x, top, w, h, h / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const lead = rtl ? x + w - padX : x + padX;                    // the reading start
  const dotX = rtl ? lead - dot : lead;
  const textX = rtl ? dotX - gap - textW : lead + dot + gap;
  const scoreX = rtl ? x + padX : x + w - padX - scoreW;

  ctx.beginPath();
  ctx.arc(dotX + dot / 2, top + h / 2, dot / 2, 0, Math.PI * 2);
  ctx.fillStyle = verdict.color;
  ctx.fill();

  const baseline = top + h / 2 + p(5);
  ctx.font = `700 ${textPx}px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(verdict.text, textX, baseline);
  if (score) {
    // A percentage is digits and a sign: LTR, or the '%' lands on the wrong side.
    ctx.direction = 'ltr';
    ctx.font = `800 ${textPx}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(score, scoreX, baseline);
  }
  ctx.restore();
  return h;
}

/** Draws whichever of the two are on, stacked from `top`. Returns the height used. */
function drawCardFooter(c: LayoutCtx, top: number): number {
  const { ctx, font, bars, accent } = c;
  let y = top;
  if (bars) {
    drawShareBars(
      ctx,
      font,
      bars,
      { x: p(24), y, w: STORY_W - p(48), h: p(BARS_H) },
      {
        // Which end the sequence starts at is a property of the LABEL's script, the
        // same test `drawValueWithUnit` uses for which side a unit goes on — the
        // card's language is not the app's, so a locale flag would be the wrong one.
        rtl: /[֐-׿]/.test(bars.label),
        accent,
        labelPx: p(14),
        axisPx: p(11),
        radius: p(4),
      },
    );
    y += p(BARS_H) + p(FOOTER_GAP);
  }
  if (c.verdict) y += drawVerdictPill(c, y) + p(FOOTER_GAP);
  return y - top;
}

/**
 * Draw `img` as large as fits in the w×h box, anchored at `ax` (0 = the box's left
 * edge, .5 its centre, 1 its right edge) and at the box's `ay` (0 top, 1 bottom).
 * Returns the size it drew, so a slot built for one shape can hold another.
 */
function drawFitted(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  box: { x: number; y: number; w: number; h: number }, ax: number, ay: number, alpha: number,
): { w: number; h: number } {
  const scale = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, box.x + (box.w - w) * ax, box.y + (box.h - h) * ay, w, h);
  ctx.globalAlpha = 1;
  return { w, h };
}

/**
 * The lettering slot, centred at `cx`: the wordmark's own box at `width`, holding
 * whichever mark was picked. Never accented. Returns the drawn size.
 */
function drawWordmarkSlot(
  c: LayoutCtx, top: number, width: number, cx = CX, badgeSide = width * 0.7,
): { w: number; h: number } {
  const img = c.brand ?? c.wordmark;
  if (!img) return { w: 0, h: 0 };
  const boxH = c.wordmark ? (c.wordmark.height / c.wordmark.width) * width : width * 0.38;
  if (img === c.logo) {
    // The badge is round, with fine type inside: fitted into the lettering's flat
    // box it came out a third of the lettering's width and unreadable. It gets a
    // square (70% of the slot's width unless the layout asks for less) instead, grown evenly about the slot's
    // middle, and reports the slot's own height so nothing under it moves.
    const side = badgeSide;
    const d = drawFitted(c.ctx, img, { x: cx - side / 2, y: top + boxH / 2 - side / 2, w: side, h: side }, 0.5, 0.5, 0.95);
    return { w: d.w, h: boxH };
  }
  return drawFitted(c.ctx, img, { x: cx - width / 2, y: top, w: width, h: boxH }, 0.5, 0.5, 0.95);
}

/** The lettering slot's drawn height, for the layouts that only stack under it. */
function drawWordmark(c: LayoutCtx, top: number, width: number, cx = CX): number {
  return drawWordmarkSlot(c, top, width, cx).h;
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
  markLogo(ctx, x, y, size, size);
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
function layoutClassic({
  ctx, font, act, logo, brand, shadow, shadowBlur, accent, i18n, showTitle, showStartTime,
}: LayoutCtx) {
  const right = STORY_W - MARGIN;
  // ONE centred column. The title and the distance used to be flush right while the
  // stats row and the badge below them were centred, so the card leaned into its
  // right edge with a dead third on the left — reported as "הסידור של הכותרת -
  // ריצה - בצד ימין. שווה אולי לסדר את הסידור של הכותרות". Right-aligning Hebrew
  // is correct for a paragraph; this is a stack of one-line headlines over a
  // centred badge, and the mixed axis was the thing that read as wrong.
  const cx = STORY_W / 2;
  let y = STORY_H - MARGIN;

  const mark = brand ?? logo;
  if (mark) {
    // The logo is a square badge with fine internal type ("EST. 2022"), not a
    // wordmark — below ~140px on a 1080-wide canvas that inner text turns to mush.
    const logoH = drawFitted(ctx, mark, { x: (STORY_W - 480) / 2, y: y - 230, w: 480, h: 230 }, 0.5, 1, 0.95).h;
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
  const secondary = secondaryStats(act, i18n, showStartTime);
  // A fourth column cuts each one to ~230px, and "1:02:33" at 64px does not fit
  // that — so the row steps down a size rather than letting two stats collide.
  const dense = secondary.length > 3;
  drawSecondaryRow(ctx, secondary, {
    font,
    left: MARGIN,
    right,
    baseline: y,
    valuePx: dense ? 54 : 64,
    labelPx: dense ? 28 : 32,
    labelGap: dense ? 40 : 44,
  });
  y -= 96;

  drawHeroDistance(ctx, act, i18n, {
    font,
    x: cx,
    align: 'center',
    baseline: y,
    numberPx: 180,
    unitPx: 48,
  });
  y -= 200;

  if (act.activityName && showTitle) {
    ctx.font = `600 44px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(act.activityName, cx, y);
    ctx.textAlign = 'right';
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
function layoutCard({
  ctx, font, act, logo, brand, shadow, shadowBlur, accent, i18n, showTitle, showStartTime,
}: LayoutCtx) {
  const hasRoute = !!act.routePreview && act.routePreview.length > 2;

  const PAD = 56;
  const cardX = 70;
  const cardW = STORY_W - cardX * 2;
  const mark = brand ?? logo;
  const logoH = mark ? (mark === logo ? 150 : 112) : 0;
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
  if (mark) {
    drawFitted(ctx, mark, { x: right - 360, y, w: 360, h: logoH }, 1, 0, 0.95);
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

  // Centred on the panel, like the stats row along its bottom — see the note in
  // layoutClassic. The badge stays in the top-right corner: a corner mark is not
  // part of the column, and moving it would cost the panel its sticker look.
  const panelCx = cardX + cardW / 2;

  if (act.activityName && showTitle) {
    ctx.font = `600 40px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(act.activityName, panelCx, y + 40);
    ctx.textAlign = 'right';
    y += titleH;
  }

  // Hero distance
  const heroBaseline = y + 130;
  drawHeroDistance(ctx, act, i18n, {
    font,
    x: panelCx,
    align: 'center',
    baseline: heroBaseline,
    numberPx: 150,
    unitPx: 44,
    gap: 20,
  });
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
  const secondary = secondaryStats(act, i18n, showStartTime);
  const dense = secondary.length > 3; // See the note in layoutClassic.
  drawSecondaryRow(ctx, secondary, {
    font,
    left: cardX + PAD,
    right,
    baseline: y + 58,
    valuePx: dense ? 48 : 58,
    labelPx: dense ? 27 : 30,
    labelGap: dense ? 38 : 42,
    labelColor: 'rgba(255,255,255,0.6)',
  });
  ctx.shadowBlur = 0;
}

/** Just the number. Centred, lots of air — the best pairing with a strong photo. */
function layoutMinimal({ ctx, font, act, logo, brand, shadow, shadowBlur, i18n }: LayoutCtx) {
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

  const mark = brand ?? logo;
  if (mark) {
    drawFitted(ctx, mark, { x: cx - 210, y: STORY_H - MARGIN - 200, w: 420, h: 200 }, 0.5, 1, 0.9);
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
  const wm = drawWordmarkSlot(c, wmTop, wmW);
  const slotH = c.wordmark ? (c.wordmark.height / c.wordmark.width) * wmW : wm.h;
  if (c.showShoe) drawShoe(ctx, CX - wm.w / 2 - p(9) - p(36), wmTop + (slotH - p(36)) / 2, p(36));

  drawStatRow(c, pickedStats(c, 3), p(22), STORY_W - p(22), p(552));
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
  drawStatRow(c, pickedStats(c, 3), p(22), STORY_W - p(22), p(488));
  ctx.shadowBlur = 0;
  if (c.showShoe) drawShoe(ctx, CX - p(18), p(545), p(36));
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
  // Title above and numbers below sit close here: the badge gets a smaller square.
  const wm = drawWordmarkSlot(c, wmTop, wmW, CX, p(76));
  if (c.showShoe) drawShoe(ctx, CX - wm.w / 2 - p(48), wmTop + p(9), p(36));

  drawStatRow(c, pickedStats(c, 3), p(18), STORY_W - p(18), p(368));
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
  if (c.showShoe) drawShoe(ctx, CX - wmW / 2 - p(48), wmTop + p(9), p(36));

  const stats = pickedStats(c, 6);
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

  // Under the grid, not at a fixed height: a three-stat card is one row shorter, and
  // leaving the gap would read as something having failed to draw.
  const rows = Math.max(1, Math.ceil(stats.length / cols));
  drawCardFooter(c, p(342) + rows * rowPitch);
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
  for (const s of pickedStats(c, 3)) {
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

  const stats = pickedStats(c, 3);
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

/**
 * The rows of the `splits` list: one per kilometre up to SPLITS_MAX_ROWS, and one
 * per two kilometres above it, so an ultra still fits the frame. A pair's pace is
 * the mean of its two; `km` is the kilometre the row ENDS on.
 */
export function splitRows(act: Pick<FeedActivity, 'paceBands' | 'distance'>): { km: number; pace: number }[] {
  const n = paceBandCount(act);
  if (n < 2) return [];
  const paces = act.paceBands!.slice(0, n);
  if (n <= SPLITS_MAX_ROWS) return paces.map((pace, i) => ({ km: i + 1, pace }));
  const rows: { km: number; pace: number }[] = [];
  for (let i = 0; i < n; i += 2) {
    const pair = paces.slice(i, i + 2);
    rows.push({ km: i + pair.length, pace: pair.reduce((a, b) => a + b, 0) / pair.length });
  }
  return rows;
}

/** "23.09.26" from the stored "2026-09-23 06:01:40" — its own parts, no timezone. */
function shortDate(startTime: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startTime);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : null;
}

/**
 * Kilometre by kilometre, and nothing else: no route and no summary numbers.
 *
 * Requested against a Strava story that pasted its own splits list beside our card,
 * because we had no view like it. So this is ONLY the list, with the stairs mark as
 * its one logo, beside the heading. The longest bar is the fastest kilometre; the
 * slowest keeps a fifth of the track so it never reads as missing.
 *
 * The panel sits on the reading-start side, which follows the CARD's language —
 * the same script test the footer bars use, for the same reason.
 */
function layoutSplits(c: LayoutCtx) {
  if (c.splitMode === 'segments' && (c.act.lapBands?.length ?? 0) >= 2) {
    layoutSegments(c);
    return;
  }
  const { ctx, font, act, stairs, accent, shadow, shadowBlur, i18n } = c;
  const rows = splitRows(act);
  if (!rows.length) return;
  const rtl = /[\u0590-\u05FF]/.test(i18n.splits);

  const w = p(214);
  const x0 = rtl ? STORY_W - p(22) - w : p(22);
  const x1 = x0 + w;
  const start = rtl ? x1 : x0;
  const dir = rtl ? -1 : 1;
  const bottom = p(600);
  const top = p(56);

  const title = c.showTitle && act.activityName ? act.activityName : null;
  const date = c.showDate ? shortDate(act.startTime) : null;
  const headH = p(34);
  const metaH = title || date ? p(18) : 0;

  // Full size up to ~30 rows; past that every row shrinks alike, text and bar
  // together, so a marathon's 42 still sit between the heading and the bottom.
  const rowH = Math.min(p(13.5), (bottom - top - headH - metaH) / rows.length);
  const k = rowH / p(13.5);
  const kmW = p(15);
  const paceW = p(29);
  const gap = p(4);
  const trackH = Math.max(p(3.5), p(6) * k);
  const rowFont = Math.max(p(7.5), p(9.5) * k);
  let y = bottom - rows.length * rowH - headH - metaH;

  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  if (metaH) {
    // Name and date as two runs, never one string: a Hebrew name followed by
    // digits is exactly the mixed-direction line the bidi algorithm reorders.
    // Name, then date, in reading order — as two runs, never one string: a Hebrew
    // name followed by digits is the mixed-direction line bidi reorders.
    const base = y + p(12);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = rtl ? 'right' : 'left';
    let cursor = start;
    if (title) {
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.font = `700 ${p(10)}px ${font}`;
      const room = w - (date ? p(58) : 0);
      ctx.fillText(title, cursor, base, room);
      cursor += dir * Math.min(room, ctx.measureText(title).width);
    }
    if (date) {
      ctx.direction = 'ltr';
      ctx.font = `500 ${p(10)}px ${font}`;
      ctx.fillText(title ? (rtl ? `${date} · ` : ` · ${date}`) : date, cursor, base);
    }
    y += metaH;
  }

  // The heading, and the stairs at the far end of the same line.
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.font = `800 ${p(16)}px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(i18n.splits, start, y + p(20));
  const mark = c.brand ?? stairs;
  if (mark) {
    // A box the stairs fill exactly (p(26) tall), wide enough for the lettering.
    const bw = p(64);
    const bh = mark === c.logo ? p(46) : p(26);
    drawFitted(ctx, mark, { x: rtl ? x0 : x1 - bw, y: y + p(23) - bh, w: bw, h: bh }, rtl ? 0 : 1, 1, 1);
  }
  y += headH;

  const paces = rows.map(r => r.pace);
  const fast = Math.min(...paces);
  const slow = Math.max(...paces);
  const trackW = w - kmW - paceW - gap * 2;
  const trackStart = start + dir * (kmW + gap);

  for (const r of rows) {
    const mid = y + rowH / 2;
    ctx.direction = 'ltr';
    ctx.font = `600 ${rowFont}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillText(String(r.km), start, mid + rowFont * 0.36);
    ctx.textAlign = rtl ? 'left' : 'right';
    ctx.fillText(formatPace(r.pace), rtl ? x0 : x1, mid + rowFont * 0.36);

    const saved = ctx.shadowBlur;
    ctx.shadowBlur = 0;
    const tx = rtl ? trackStart - trackW : trackStart;
    roundRectPath(ctx, tx, mid - trackH / 2, trackW, trackH, trackH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
    const share = slow === fast ? 1 : 0.2 + (0.8 * (slow - r.pace)) / (slow - fast);
    const bw = Math.max(trackH, trackW * share);
    roundRectPath(ctx, rtl ? trackStart - bw : trackStart, mid - trackH / 2, bw, trackH, trackH / 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.shadowBlur = saved;
    y += rowH;
  }
  ctx.shadowBlur = 0;

  if (c.avgLine && slow > fast) {
    // Where a bar at the run's average pace would end: every bar reaching past it
    // was a faster-than-average kilometre. Same scale as the bars, so it can't lie.
    const own = act.averagePace;
    const avg = own != null && Number.isFinite(own) && own > 0
      ? own : paces.reduce((a, b) => a + b, 0) / paces.length;
    const share = Math.min(1, Math.max(0.2, 0.2 + (0.8 * (slow - avg)) / (slow - fast)));
    const ax = trackStart + dir * trackW * share;
    const rowsTop = y - rows.length * rowH;
    ctx.save();
    ctx.setLineDash([p(2.5), p(2)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = p(0.9);
    ctx.beginPath();
    ctx.moveTo(ax, rowsTop - p(1));
    ctx.lineTo(ax, y);
    ctx.stroke();
    ctx.restore();
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.font = `700 ${p(7)}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`avg ${formatPace(avg)}`, ax, rowsTop - p(3));
  }
}

/**
 * The KM Splits view's other chart: every lap the watch pressed, the way Strava's
 * workout analysis draws them. Asked for on a workout run, where a lap is a STEP —
 * a 400 m rep, a 90 s float — and binning it into kilometres averages the workout
 * away.
 *
 * A bar's WIDTH is the lap's distance and its HEIGHT its speed, so a long easy lap
 * is a wide low block and a short rep a narrow tall one; speed rather than pace
 * because taller has to mean faster. The fastest third of the range is in the
 * accent, the rest white fading with slowness, which is what makes the reps read
 * as reps. Time runs in the card's reading direction, right to left on a Hebrew
 * card, unless `timeLtr` asks for left to right with the scale kept on the right.
 */
function layoutSegments(c: LayoutCtx) {
  const { ctx, font, act, stairs, accent, shadow, shadowBlur, i18n } = c;
  const laps = act.lapBands ?? [];
  const rtl = /[\u0590-\u05FF]/.test(i18n.segments);

  const x0 = p(22);
  const w = STORY_W - p(44);
  const x1 = x0 + w;
  const start = rtl ? x1 : x0;
  const dir = rtl ? -1 : 1;
  const chartH = p(170);
  const bottom = p(600);
  const chartTop = bottom - chartH;

  const title = c.showTitle && act.activityName ? act.activityName : null;
  const date = c.showDate ? shortDate(act.startTime) : null;
  const headH = p(34);
  const metaH = title || date ? p(18) : 0;
  let y = chartTop - p(14) - headH - metaH;

  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  if (metaH) {
    const base = y + p(12);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = rtl ? 'right' : 'left';
    let cursor = start;
    if (title) {
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.font = `700 ${p(10)}px ${font}`;
      const room = w - p(80) - (date ? p(58) : 0);
      ctx.fillText(title, cursor, base, room);
      cursor += dir * Math.min(room, ctx.measureText(title).width);
    }
    if (date) {
      ctx.direction = 'ltr';
      ctx.font = `500 ${p(10)}px ${font}`;
      ctx.fillText(title ? (rtl ? `${date} · ` : ` · ${date}`) : date, cursor, base);
    }
    y += metaH;
  }

  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.font = `800 ${p(16)}px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(i18n.segments, start, y + p(20));
  const mark = c.brand ?? stairs;
  if (mark) {
    const bw = p(64);
    const bh = mark === c.logo ? p(46) : p(26);
    drawFitted(ctx, mark, { x: rtl ? x0 : x1 - bw, y: y + p(23) - bh, w: bw, h: bh }, rtl ? 0 : 1, 1, 1);
  }

  const paces = laps.map(l => l.pace);
  const fast = Math.min(...paces);
  const slow = Math.max(...paces);
  const total = laps.reduce((a, l) => a + l.m, 0);
  // Speed, floored at 80% of the slowest lap's so the slowest bar still stands, but
  // never below half the fastest: a standing rest is 18:00/km, and letting it set
  // the floor squashed every running lap into the top of the chart and stacked a
  // dozen pace labels on top of each other. A lap slower than the floor keeps a stub.
  const speed = (pace: number) => 1000 / pace;
  const vMax = speed(fast);
  const vMin = Math.max(speed(slow) * 0.8, vMax * 0.5);
  const floorPace = 1000 / vMin;
  const yOf = (pace: number) =>
    Math.min(bottom - p(3), bottom - ((speed(pace) - vMin) / (vMax - vMin || 1)) * chartH);
  const slowSeen = Math.min(slow, floorPace);

  // The pace scale takes a gutter on the reading-start side.
  const gutter = p(26);
  const barsW = w - gutter;
  // The direction time runs in, which `timeLtr` can turn against the text's.
  const trtl = rtl && !c.timeLtr;
  const tdir = trtl ? -1 : 1;
  const barsStart = trtl ? start + dir * gutter : rtl ? x0 : x0 + gutter;
  const gap = p(1.2);

  ctx.shadowBlur = 0;

  // Heart rate behind the bars. From the watch's own trace when the editor has it:
  // a curve through each lap's average was too round next to Strava's (feedback
  // 2026-09-29), with none of the climb inside a rep or the drop in the rest after
  // it. The trace is drawn in straight steps with only a three-point mean, which is
  // how Strava's reads. Without one, each lap holds its average from a third of
  // the way in to its end: heart rate lags the effort, so a rep's climb starts
  // late and runs into the rest after it. Through the laps' middles, as a curve it
  // was too round and as straight lines a row of spikes.
  const hrs = laps.map(l => l.hr).filter((h): h is number => h != null);
  const trace = c.editorChart && act.hrTrace && act.hrTrace.length >= 10 ? act.hrTrace : null;
  let hrLine: Path2D | null = null;
  if (c.hrLine && hrs.length >= 2) {
    const pts: Array<[number, number]> = [];
    let hx = barsStart;
    const end = barsStart + tdir * barsW;
    if (trace) {
      const bpm = trace.map((_, i) => {
        const near = trace.slice(Math.max(0, i - 1), i + 2);
        return near.reduce((a, q) => a + q[1], 0) / near.length;
      });
      // The warm-up's first minute sits far under the rest; letting it set the floor
      // would flatten the whole session into the top of the chart.
      const sorted = [...bpm].sort((a, b) => a - b);
      const hLo = sorted[Math.floor(sorted.length * 0.05)]! - 6;
      const hHi = sorted[sorted.length - 1]! + 2;
      const hY = (h: number) => Math.min(bottom, bottom - ((h - hLo) / (hHi - hLo || 1)) * chartH * 0.9);
      trace.forEach(([m], i) => pts.push([barsStart + tdir * Math.min(1, m / total) * barsW, hY(bpm[i]!)]));
      hx = end;
    } else {
      const hLo = Math.min(...hrs) - 6;
      const hHi = Math.max(...hrs) + 2;
      const hY = (h: number) => bottom - ((h - hLo) / (hHi - hLo)) * chartH * 0.9;
      let last = hrs[0];
      for (const l of laps) {
        const bw = (l.m / total) * barsW;
        last = l.hr ?? last;
        // A 20 m pause is a hairline on the chart; as a line point it is a cliff.
        if (l.m >= total * 0.015) {
          if (c.editorChart) pts.push([hx + (tdir * bw) / 3, hY(last)], [hx + tdir * bw, hY(last)]);
          else pts.push([hx + (tdir * bw) / 2, hY(last)]);
        }
        hx += tdir * bw;
      }
      if (pts.length === 0) pts.push([barsStart + (tdir * barsW) / 2, hY(last)]);
    }
    pts.unshift([barsStart, pts[0][1]]);
    pts.push([hx, pts[pts.length - 1][1]]);
    hrLine = new Path2D();
    hrLine.moveTo(pts[0][0], pts[0][1]);
    if (c.editorChart) {
      for (let i = 1; i < pts.length; i++) hrLine.lineTo(pts[i][0], pts[i][1]);
    } else {
      // The club's chart until the editor's is rolled out: a curve through the middles.
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        hrLine.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      hrLine.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
    const fill = new Path2D(hrLine);
    fill.lineTo(hx, bottom);
    fill.lineTo(barsStart, bottom);
    fill.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill(fill);
  }

  let cursor = barsStart;
  for (const l of laps) {
    const bw = (l.m / total) * barsW;
    const top = yOf(l.pace);
    const t = slowSeen === fast ? 0 : Math.min(1, (l.pace - fast) / (slowSeen - fast));
    ctx.fillStyle = t < 0.35 ? accent : `rgba(255,255,255,${(0.85 - 0.5 * t).toFixed(3)})`;
    const drawW = Math.max(bw - gap, p(0.8));
    const r = Math.max(0, Math.min(drawW / 2, p(4)));
    const left = trtl ? cursor - bw + gap / 2 : cursor + gap / 2;
    ctx.beginPath();
    ctx.roundRect(left, top, drawW, bottom - top, [r, r, 0, 0]);
    ctx.fill();
    cursor += tdir * bw;
  }

  if (hrLine) {
    ctx.save();
    ctx.strokeStyle = 'rgba(210,215,230,0.7)';
    ctx.lineWidth = p(1);
    ctx.lineJoin = 'round';
    ctx.stroke(hrLine);
    ctx.restore();
    ctx.shadowBlur = shadowBlur;
    ctx.direction = 'ltr';
    ctx.textAlign = rtl ? 'left' : 'right';
    ctx.font = `600 ${p(8.5)}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`♥ ${Math.min(...hrs)}–${Math.max(...hrs)}`, rtl ? x0 : x1, bottom + p(13));
    ctx.shadowBlur = 0;
  }

  const avg = act.averagePace != null && Number.isFinite(act.averagePace) && act.averagePace > 0
    ? act.averagePace
    : laps.reduce((a, l) => a + l.pace * l.m, 0) / total;
  const ay = yOf(avg);
  const showAvg = c.avgLine && ay >= chartTop && ay <= bottom;

  ctx.shadowBlur = shadowBlur;
  ctx.direction = 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.font = `600 ${p(8.5)}px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  // Whole-minute-ish ticks across the range, skipped where the avg label sits.
  // A label needs its own line: none within p(11) of another, nor of the avg label.
  const taken: number[] = showAvg ? [ay - p(4)] : [];
  // The fastest lap is the top of the scale, and it is the number the chart is
  // shared for, so it is labelled first; the round values fill in under it. It
  // used to start at the first round value, so a 3:42 rep's top read "4:00".
  const topY = yOf(fast) + p(3);
  if (c.editorChart && !taken.some(y => Math.abs(y - topY) < p(11))) {
    ctx.fillText(formatPace(fast), start, topY);
    taken.push(topY);
  }
  // Half-minute steps unless the range is wide: at whole minutes a session of
  // 3:40 reps under a 3:05 stride had no label between 3:05 and 4:00, right where
  // the reps are. Labels that would crowd each other are skipped below anyway.
  const step = floorPace - fast > (c.editorChart ? 330 : 150) ? 60 : 30;
  for (let pc = Math.ceil(fast / step) * step; pc <= floorPace; pc += step) {
    const ty = yOf(pc);
    if (ty < chartTop - p(2) || ty > bottom - p(4)) continue;
    if (taken.some(y => Math.abs(y - (ty + p(3))) < p(11))) continue;
    ctx.fillText(formatPace(pc), start, ty + p(3));
    taken.push(ty + p(3));
  }

  if (showAvg) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.setLineDash([p(4), p(3)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = p(1);
    ctx.beginPath();
    ctx.moveTo(barsStart, ay);
    ctx.lineTo(barsStart + tdir * barsW, ay);
    ctx.stroke();
    ctx.restore();
    ctx.fillText(`avg ${formatPace(avg)}`, start, ay - p(4));
  }
  ctx.shadowBlur = 0;
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
  splits: layoutSplits,
};

/**
 * A Hebrew title keeps its numbers in the order they were typed.
 *
 * "10×400 בפארק" came out of the canvas as "400×10 בפארק": in a right-to-left line
 * the × between two numbers takes the line's direction, so the two numbers swap
 * sides. Each run that starts and ends with a digit or a Latin letter is wrapped
 * in a left-to-right embedding (LRE … PDF), which every canvas honours; a title
 * with no Hebrew in it is left alone.
 */
export function isolateLtrRuns(text: string): string {
  if (!/[\u0590-\u05FF]/.test(text)) return text;
  return text.replace(/[0-9A-Za-z](?:[0-9A-Za-z×x*\/:.,+\- ]*[0-9A-Za-z])?/g, run => `\u202A${run}\u202C`);
}

/** Renders the card and returns a blob ready for navigator.share(). */
export async function renderShareCard(
  item: FeedItem,
  i18n: ShareI18n,
  opts: ShareCardOptions = {},
): Promise<Blob> {
  const raw = item.activity;
  if (!raw) throw new Error('Share card requires an activity');
  const act = raw.activityName ? { ...raw, activityName: isolateLtrRuns(raw.activityName) } : raw;

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
  const wantStairs = template === 'sideBySide' || template === 'splits' || opts.brand === 'stairs';
  const [logo, wordmark, stairs] = await Promise.all([
    loadImage(LOGO_SRC).catch(() => null),
    loadImage(WORDMARK_SRC).catch(() => null),
    wantStairs ? loadImage(STAIRS_SRC).catch(() => null) : Promise.resolve(null),
  ]);
  const brand = opts.brand === 'badge' ? logo : opts.brand === 'wordmark' ? wordmark : opts.brand === 'stairs' ? stairs : null;

  const marks = new Set<unknown>([logo, wordmark, stairs].filter(Boolean));
  const stopHitMap = opts.onHitMap
    ? recordHitMap(ctx, {
      isMark: src => marks.has(src) || (typeof src === 'object' && src !== null && TINTED.has(src)),
      title: (opts.showTitle ?? true) && act.activityName ? act.activityName : null,
      date: (opts.showDate ?? true) ? shortDate(act.startTime) : null,
      width: STORY_W,
      height: STORY_H,
    })
    : null;

  // Over an unknown background the only thing keeping white text readable is the
  // shadow, so the transparent variant leans on it harder.
  LAYOUTS[template]({
    ctx,
    font,
    act,
    logo,
    wordmark,
    stairs,
    brand,
    avgLine: opts.avgLine ?? false,
    hrLine: opts.hrLine ?? false,
    editorChart: opts.editorChart ?? false,
    timeLtr: opts.timeLtr ?? false,
    splitMode: opts.splitMode ?? 'km',
    shadow: transparent ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.45)',
    shadowBlur: transparent ? 28 : 16,
    accent: ACCENT_HEX[opts.accent ?? 'white'],
    i18n,
    showTitle: opts.showTitle ?? true,
    showStartTime: opts.showStartTime ?? true,
    showDate: opts.showDate ?? true,
    showShoe: opts.showShoe ?? true,
    metrics: opts.metrics ?? DEFAULT_WORKOUT_METRICS,
    // Gated here as well as in the sheet: a template with no room for a footer must
    // not be able to draw one over its own content, whoever asked.
    bars: supportsFooter(template) ? opts.bars ?? null : null,
    verdict: supportsFooter(template) ? opts.verdict ?? null : null,
  });
  if (stopHitMap) opts.onHitMap!(stopHitMap());

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
  // Safari reads the file after click() returns; revoking at once fails the save.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
