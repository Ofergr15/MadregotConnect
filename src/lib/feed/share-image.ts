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
   * Which numbers go on the card, chosen by the athlete in the sheet.
   *
   * Defaults to distance/pace/time, which is what the newer views printed before
   * the chips existed — so a caller that doesn't pass this gets exactly the card
   * it got before. The legacy three (`classic`, `card`, `minimal`) ignore it: they
   * draw `secondaryStats` and have their own fixed row.
   */
  metrics?: WorkoutMetricKey[];
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

/** The chosen metrics, in card order, skipping any this run doesn't carry. */
export function workoutStats(
  act: FeedActivity,
  i18n: ShareI18n,
  keys: WorkoutMetricKey[],
): Stat[] {
  return WORKOUT_METRIC_KEYS
    .filter(key => keys.includes(key))
    .map(key => workoutMetricStat(act, i18n, key))
    .filter((s): s is Stat => !!s);
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
  shadow: string;
  shadowBlur: number;
  /** Resolved accent hex — route line only. */
  accent: string;
  i18n: ShareI18n;
  showTitle: boolean;
  showStartTime: boolean;
  /** The chosen numbers, in card order — see WORKOUT_METRICS. */
  metrics: WorkoutMetricKey[];
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
function layoutClassic({
  ctx, font, act, logo, shadow, shadowBlur, accent, i18n, showTitle, showStartTime,
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
  ctx, font, act, logo, shadow, shadowBlur, accent, i18n, showTitle, showStartTime,
}: LayoutCtx) {
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
  drawShoe(ctx, CX - wmW / 2 - p(48), wmTop + p(9), p(36));

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
    showStartTime: opts.showStartTime ?? true,
    metrics: opts.metrics ?? DEFAULT_WORKOUT_METRICS,
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
