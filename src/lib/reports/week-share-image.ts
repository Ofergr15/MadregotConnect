import {
  STORY_W, STORY_H, drawCover, loadImage, resolveFontStack, roundRectPath,
} from '@/lib/feed/share-image';
import type { Last7Report } from './last-7-days';
import { selectedMetrics, type WeekMetricKey } from './week-share';

/**
 * The seven-day report as a 1080×1920 story image.
 *
 * Same frame and the same export path as the single-activity card
 * (lib/feed/share-image.ts, whose helpers this imports rather than copies), so
 * the two kinds of share cannot drift apart on font, crop or encoding.
 *
 * The design is a frosted panel over a photo, one row per metric — the layout he
 * approved in the `view=list` mockup. It is deliberately NOT the bar chart that
 * sits on the profile: bars need a legend and a scale to mean anything, and a
 * story is read in about a second by somebody who does not know the athlete's
 * normal week. A label and a number on their own line survive that second.
 *
 * "Frosted" on a canvas is a real blur of the photo behind the panel, drawn
 * clipped to the panel's own rounded path. `ctx.filter` is Safari 17+; where it is
 * missing the panel just comes out as a flat translucent slab, which is a
 * degradation in depth only and still perfectly legible.
 */

/** Ships in /public/images — the club's own photo, so an empty card is never blank. */
export const DEFAULT_WEEK_BACKGROUND = '/images/runners-group.jpg';
const LOGO_SRC = '/images/logo-white.png';

/** Every string the card prints, resolved by the caller from next-intl. */
export interface WeekShareI18n {
  /** "7 הימים האחרונים" */
  title: string;
  /** One label per metric key, already translated. */
  labels: Record<WeekMetricKey, string>;
}

export interface WeekShareOptions {
  /** A photo the athlete picked; falls back to the club photo. */
  background?: Blob | null;
  /** Printed under the title with the date range. */
  athleteName?: string | null;
  metrics: WeekMetricKey[];
  i18n: WeekShareI18n;
  /** RTL flips the panel's text alignment, nothing else. */
  rtl?: boolean;
}

const MARGIN = 80;
const PANEL_RADIUS = 56;

const fd = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * The window as one string. In RTL the LATER date has to come first, because the
 * line is laid out right-to-left and "13.09 – 19.09" would otherwise be read as
 * ending on the 13th — the same bidi trap as the fractions elsewhere in the app.
 */
export function formatWeekRange(report: Last7Report, rtl: boolean): string {
  return rtl
    ? `${fd(report.to)} – ${fd(report.from)}`
    : `${fd(report.from)} – ${fd(report.to)}`;
}

export async function renderWeekShareCard(
  report: Last7Report,
  opts: WeekShareOptions,
): Promise<Blob> {
  // Otherwise the first paint uses a fallback face and every number is subtly wrong.
  await document.fonts.ready;
  const font = resolveFontStack();
  const rtl = opts.rtl ?? false;

  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  // ── Background ────────────────────────────────────────────────────────────
  let bg: CanvasImageSource | null = null;
  let bgW = 0;
  let bgH = 0;
  if (opts.background) {
    try {
      const bitmap = await createImageBitmap(opts.background);
      bg = bitmap;
      bgW = bitmap.width;
      bgH = bitmap.height;
    } catch {
      // A HEIC the browser cannot decode — fall through to the club photo rather
      // than failing the whole share.
    }
  }
  if (!bg) {
    const img = await loadImage(DEFAULT_WEEK_BACKGROUND).catch(() => null);
    if (img) {
      bg = img;
      bgW = img.naturalWidth;
      bgH = img.naturalHeight;
    }
  }

  if (bg) {
    drawCover(ctx, bg, bgW, bgH);
    // The mockup's `saturate(.9) brightness(.82)`: a photo at full strength fights
    // the panel for attention and the numbers stop being the subject.
    ctx.fillStyle = 'rgba(8,10,20,0.22)';
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  } else {
    const g = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
    g.addColorStop(0, '#2f45ff');
    g.addColorStop(1, '#1b1150');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  }

  // ── Panel geometry ────────────────────────────────────────────────────────
  const rows = selectedMetrics(report, opts.metrics);
  const panelW = STORY_W - MARGIN * 2;
  const headerH = 200;
  const rowH = 150;
  const panelH = headerH + Math.max(rows.length, 1) * rowH + 40;
  const panelX = MARGIN;
  const panelY = Math.round((STORY_H - panelH) / 2);

  // Frost: the photo again, blurred, clipped to the panel.
  if (bg) {
    ctx.save();
    roundRectPath(ctx, panelX, panelY, panelW, panelH, PANEL_RADIUS);
    ctx.clip();
    try {
      ctx.filter = 'blur(40px)';
    } catch {
      // Older Safari: no filter property. The slab below still carries the panel.
    }
    drawCover(ctx, bg, bgW, bgH);
    ctx.filter = 'none';
    ctx.restore();
  }

  ctx.save();
  roundRectPath(ctx, panelX, panelY, panelW, panelH, PANEL_RADIUS);
  ctx.fillStyle = 'rgba(10,14,32,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ── Header ────────────────────────────────────────────────────────────────
  const padX = 56;
  const textX = rtl ? panelX + panelW - padX : panelX + padX;
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 54px ${font}`;
  ctx.fillText(opts.i18n.title, textX, panelY + 90);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 32px ${font}`;
  const sub = [opts.athleteName, formatWeekRange(report, rtl)].filter(Boolean).join(' · ');
  ctx.fillText(sub, textX, panelY + 140);

  // The club mark, opposite the heading whichever way the panel reads.
  const logo = await loadImage(LOGO_SRC).catch(() => null);
  if (logo) {
    const h = 74;
    const w = (logo.width / logo.height) * h;
    const x = rtl ? panelX + padX : panelX + panelW - padX - w;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, x, panelY + 52, w, h);
    ctx.globalAlpha = 1;
  }

  // ── One row per metric ────────────────────────────────────────────────────
  const valueX = rtl ? panelX + padX : panelX + panelW - padX;
  rows.forEach((m, i) => {
    const top = panelY + headerH + i * rowH;
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(panelX + padX, top);
      ctx.lineTo(panelX + panelW - padX, top);
      ctx.stroke();
    }
    const baseline = top + 100;

    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `700 36px ${font}`;
    ctx.fillText(opts.i18n.labels[m.key], textX, baseline - 8);

    // The value sits against the opposite edge, so a glance down the card reads a
    // column of numbers rather than hunting for each one after its label.
    ctx.textAlign = rtl ? 'left' : 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 72px ${font}`;
    ctx.fillText(m.total(report), valueX, baseline);
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode share image'))),
      'image/jpeg',
      0.92,
    );
  });
}
