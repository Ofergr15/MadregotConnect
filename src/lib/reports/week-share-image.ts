import {
  STORY_W, STORY_H, drawCover, loadImage, resolveFontStack, roundRectPath,
} from '@/lib/feed/share-image';
import type { Last7Report } from './last-7-days';
import {
  WEEK_CARD_TEXT, selectedMetrics, type WeekCardLang, type WeekMetricKey,
} from './week-share';

/**
 * The seven-day report as a 1080×1920 story image.
 *
 * Same frame and the same export path as the single-activity card
 * (lib/feed/share-image.ts, whose helpers this imports rather than copies), so
 * the two kinds of share cannot drift apart on font, crop or encoding.
 *
 * The design is a frosted panel, one row per metric — the layout he approved in
 * the `view=list` mockup. It is deliberately NOT the bar chart that sits on the
 * profile: bars need a legend and a scale to mean anything, and a story is read in
 * about a second by somebody who does not know the athlete's normal week. A label
 * and a number on their own line survive that second.
 *
 * It opens on the club photo and the athlete can swap in their own in one tap —
 * his call, once the picker existed: a card that starts blank asks everyone to do
 * work before they can post, and the gradient is still there as the floor if the
 * photo fails to decode.
 *
 * "Frosted" on a canvas is a real blur of the photo behind the panel, drawn
 * clipped to the panel's own rounded path. `ctx.filter` is Safari 17+; where it is
 * missing the panel just comes out as a flat translucent slab, which is a
 * degradation in depth only and still perfectly legible.
 */

/** Ships in /public/images — the club's own photo, so an empty card is never blank. */
export const DEFAULT_WEEK_BACKGROUND = '/images/runners-group.jpg';
const LOGO_SRC = '/images/logo-white.png';

export interface WeekShareOptions {
  /** A photo the athlete picked; falls back to the club photo. */
  background?: Blob | null;
  /**
   * Printed under the title with the date range. Empty or null prints the range
   * alone — a share to a public network is not always a share under your name.
   */
  athleteName?: string | null;
  metrics: WeekMetricKey[];
  /** The card's language, chosen per share; also decides the panel's direction. */
  lang: WeekCardLang;
}

const MARGIN = 80;
const PANEL_RADIUS = 56;
/** Nearly a third of the width: the club mark is the point of posting this. */
const LOGO_SIZE = 260;

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
  const rtl = opts.lang === 'he';
  const text = WEEK_CARD_TEXT[opts.lang];

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
  // The logo owns the top of the card, so the panel is centred in what is LEFT
  // rather than in the frame — centring it in the frame would ride up under the
  // mark on a six-row card.
  const logoBottom = MARGIN + 40 + LOGO_SIZE;
  const panelY = Math.round(logoBottom + Math.max(0, STORY_H - logoBottom - panelH) / 2);

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
  ctx.fillText(text.title, textX, panelY + 90);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 32px ${font}`;
  // The name is optional; with it off the range stands alone rather than leaving a
  // stray separator behind it.
  const sub = [opts.athleteName?.trim(), formatWeekRange(report, rtl)]
    .filter(Boolean).join(' · ');
  ctx.fillText(sub, textX, panelY + 140);

  // ── The club mark ─────────────────────────────────────────────────────────
  // Big, and centred above the panel rather than tucked in its corner: this card
  // is going to networks where nobody knows the club, and a 74px mark in a corner
  // is branding that gets cropped out of a re-share.
  const logo = await loadImage(LOGO_SRC).catch(() => null);
  if (logo) {
    const h = LOGO_SIZE;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, Math.round((STORY_W - w) / 2), MARGIN + 40, w, h);
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
    ctx.fillText(text.labels[m.key], textX, baseline - 8);

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
