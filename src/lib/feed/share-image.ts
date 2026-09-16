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
const LOGO_SRC = '/images/logo-white.png';

/** Layout variants, mirroring the way Strava offers several story styles. */
export type ShareTemplate = 'classic' | 'card' | 'minimal';

export const SHARE_TEMPLATE_KEYS: ShareTemplate[] = ['classic', 'card', 'minimal'];

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
  /** Defaults to 'classic'. */
  template?: ShareTemplate;
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

/** The route polyline, fitted into a box with its aspect ratio preserved. */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  points: Array<{ lat: number; lng: number }>,
  box: { x: number; y: number; w: number; h: number },
  lineWidth = 10,
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
  ctx.strokeStyle = '#ffffff';
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

interface LayoutCtx {
  ctx: CanvasRenderingContext2D;
  font: string;
  act: FeedActivity;
  logo: HTMLImageElement | null;
  shadow: string;
  shadowBlur: number;
  i18n: ShareI18n;
  showTitle: boolean;
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

/**
 * Bottom-anchored stats with the logo centred beneath, over the full frame.
 * The stack builds upward from the bottom margin so a run with no GPS simply
 * omits the route rather than leaving a hole.
 */
function layoutClassic({ ctx, font, act, logo, shadow, shadowBlur, i18n, showTitle }: LayoutCtx) {
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
  const secondary = secondaryStats(act, i18n);
  drawSecondaryRow(ctx, secondary, {
    font,
    left: MARGIN,
    right,
    baseline: y,
    valuePx: 64,
    labelPx: 32,
    labelGap: 44,
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
      drawRoute(ctx, act.routePreview, {
        x: MARGIN,
        y: boxTop,
        w: STORY_W - MARGIN * 2,
        h: available,
      });
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
function layoutCard({ ctx, font, act, logo, shadow, shadowBlur, i18n, showTitle }: LayoutCtx) {
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
    drawRoute(ctx, act.routePreview!, { x: cardX + PAD, y, w: cardW - PAD * 2, h: routeH }, 8);
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
  const secondary = secondaryStats(act, i18n);
  drawSecondaryRow(ctx, secondary, {
    font,
    left: cardX + PAD,
    right,
    baseline: y + 58,
    valuePx: 58,
    labelPx: 30,
    labelGap: 42,
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

const LAYOUTS: Record<ShareTemplate, (c: LayoutCtx) => void> = {
  classic: layoutClassic,
  card: layoutCard,
  minimal: layoutMinimal,
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

  // ── Background ────────────────────────────────────────────────────────────
  if (!opts.transparent) {
    let drew = false;
    if (opts.background) {
      try {
        const bitmap = await createImageBitmap(opts.background);
        drawCover(ctx, bitmap, bitmap.width, bitmap.height);
        bitmap.close?.();
        drew = true;
      } catch {
        // Unreadable photo (e.g. a HEIC the browser can't decode) — fall through
        // to the gradient rather than failing the whole share.
      }
    }
    if (!drew) drawBrandGradient(ctx);
    // The card template brings its own panel, so a full-frame scrim would only
    // mute the athlete's photo for no legibility gain.
    if (opts.template !== 'card') drawScrim(ctx);
  }

  const logo = await loadImage(LOGO_SRC).catch(() => null);

  // Over an unknown background the only thing keeping white text readable is the
  // shadow, so the transparent variant leans on it harder.
  LAYOUTS[opts.template ?? 'classic']({
    ctx,
    font,
    act,
    logo,
    shadow: opts.transparent ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.45)',
    shadowBlur: opts.transparent ? 28 : 16,
    i18n,
    showTitle: opts.showTitle ?? true,
  });

  // JPEG has no alpha channel — a transparent card exported as JPEG comes out with
  // a black background, so the variant dictates the format.
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Failed to encode share image'))),
      opts.transparent ? 'image/png' : 'image/jpeg',
      opts.transparent ? undefined : 0.92,
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
