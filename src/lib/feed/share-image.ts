/**
 * Renders a 1080×1920 Instagram/Facebook story card for a run — entirely in the
 * browser, on a canvas.
 *
 * Client-side rather than server-side (Satori / @vercel/og) for two reasons: the
 * athlete's background photo never leaves the device, and Hebrew RTL layout is
 * fully under our control instead of at the mercy of a text shaper we can't debug.
 *
 * The card is deliberately OPAQUE. Strava's transparent story overlay works because
 * a native app can hand Instagram a sticker via `com.instagram.sharedSticker.*`
 * (iOS pasteboard) or an ADD_TO_STORY intent (Android) — neither is reachable from
 * a PWA. Routed through navigator.share(), Instagram treats the PNG as a photo and
 * may flatten alpha, so we composite our own background and control the result.
 */

import type { FeedItem } from './project';

export const STORY_W = 1080;
export const STORY_H = 1920;

const MARGIN = 80;
const BRAND = '#4338ff';
const LOGO_SRC = '/images/logo-white.png';

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
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.shadowBlur = 0;
  // Start (green) and finish (red) caps, same language as the feed minimap.
  for (const [pt, color] of [[pts[0], '#22c55e'], [pts[pts.length - 1], '#ef4444']] as const) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders the card and returns a JPEG blob ready for navigator.share().
 *
 * Bottom-anchored: the stack is laid out upward from the bottom margin so a run
 * with no GPS simply omits the route rather than leaving a hole.
 */
export async function renderShareCard(
  item: FeedItem,
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
    drawScrim(ctx);
  }

  // Over an unknown background the only thing keeping white text readable is the
  // shadow, so the transparent variant leans on it harder.
  const shadow = opts.transparent ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.45)';
  const shadowBlur = opts.transparent ? 28 : 16;

  // ── Text stack, built upward from the bottom ──────────────────────────────
  const right = STORY_W - MARGIN;
  let y = STORY_H - MARGIN;

  // Logo, centred at the very bottom.
  try {
    const logo = await loadImage(LOGO_SRC);
    // The logo is a square badge with fine internal type ("EST. 2022"), not a
    // wordmark — below ~140px on a 1080-wide canvas that inner text turns to mush.
    const logoH = 150;
    const logoW = (logo.width / logo.height) * logoH;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(logo, (STORY_W - logoW) / 2, y - logoH, logoW, logoH);
    ctx.globalAlpha = 1;
    y -= logoH + 64;
  } catch {
    y -= 24;
  }

  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;

  // Group · date
  const dateStr = new Date(act.startTime).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
  });
  const meta = [item.author.groupName, dateStr].filter(Boolean).join(' · ');
  ctx.font = `500 40px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(meta, right, y);
  y -= 62;

  // Athlete name
  ctx.font = `700 56px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(item.author.name, right, y);
  y -= 56;

  // Divider
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  y -= 76;

  // Secondary stats: pace and time, side by side. Numbers are LTR even in an RTL
  // layout, so each column is drawn left-aligned from its own anchor.
  ctx.shadowColor = shadow;
  ctx.shadowBlur = shadowBlur;
  const secondary: Array<{ value: string; label: string }> = [];
  if (act.averagePace) secondary.push({ value: formatPace(act.averagePace), label: 'קצב ממוצע' });
  secondary.push({ value: formatDuration(act.duration), label: 'זמן' });
  if (act.averageHr) secondary.push({ value: `${Math.round(act.averageHr)}`, label: 'דופק ממוצע' });

  const colW = (STORY_W - MARGIN * 2) / secondary.length;
  secondary.forEach((s, i) => {
    // Lay columns out right-to-left to match the Hebrew reading order.
    const cx = right - i * colW;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = `700 64px ${font}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s.value, cx, y);
    ctx.font = `500 32px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(s.label, cx, y + 44);
  });
  y -= 96;

  // Hero distance
  const km = (act.distance / 1000).toFixed(2).replace(/\.?0+$/, '');
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = `500 48px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('ק״מ', right, y);
  const unitW = ctx.measureText('ק״מ').width;

  ctx.font = `800 180px ${font}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(km, right - unitW - 24, y);
  y -= 200;

  // Activity title, if the athlete named the run.
  if (act.activityName) {
    ctx.font = `600 44px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(act.activityName, right, y);
    y -= 72;
  }

  ctx.shadowBlur = 0;

  // ── Route, in whatever vertical space is left above the text ───────────────
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
