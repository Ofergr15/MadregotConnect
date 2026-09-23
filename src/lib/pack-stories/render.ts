// Canvas half of the pack stories: draws one pack's 1080×1920 story, or its
// splits card alone. Everything it reads comes in through `StoryScene`, so the
// screen, its thumbnails and the exports all draw the same picture.

import { chartRun, fmtPace, slots, type Pack, type PackRun, type PackSession, type StoryState, type Variant, type LogoKind, type LogoColor } from './model';
import { GROUP_HEX } from '@/lib/utils';

export const STORY_W = 1080;
export const STORY_H = 1920;
const FONT = '-apple-system, "Heebo", "Segoe UI", Arial, sans-serif';

/** Story width (px on the 1080 canvas) per logo shape; height follows the image. */
export const LOGO_KINDS: Record<LogoKind, { name: string; w: number; src?: string }> = {
  badge: { name: 'הלוגו העגול', w: 170, src: '/images/logo-white.png' },
  stairs: { name: 'המדרגות', w: 150, src: '/images/stairs-white.png' },
  wordmark: { name: 'MADREGOT', w: 330, src: '/images/wordmark-white.png' },
  none: { name: 'בלי לוגו', w: 0 },
};
export const CLUB_BG_SRC = '/images/runners-group.jpg';

export interface StoryAssets {
  clubBg: HTMLImageElement | null;
  myBg: HTMLImageElement | null;
  logos: Partial<Record<LogoKind, HTMLImageElement>>;
}

export interface StoryScene {
  S: StoryState;
  sess: PackSession;
  assets: StoryAssets;
}

type Ctx = CanvasRenderingContext2D;
type Drawable = HTMLImageElement | HTMLCanvasElement;

// The assets are white; black is the same shape recoloured, cached per image.
const tinted = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
export function logoImage(assets: StoryAssets, kind: LogoKind, color: LogoColor): Drawable | null {
  const im = assets.logos[kind];
  if (!im) return null;
  if (color === 'white') return im;
  let c = tinted.get(im);
  if (!c) {
    c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d')!;
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#111';
    x.fillRect(0, 0, c.width, c.height);
    tinted.set(im, c);
  }
  return c;
}

const dims = (d: Drawable) => d instanceof HTMLImageElement ? [d.naturalWidth, d.naturalHeight] : [d.width, d.height];

function cover(ctx: Ctx, im: HTMLImageElement, W: number, H: number) {
  const s = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
  ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Number and unit are drawn as two separate runs, never one concatenated string:
// a number glued to a Hebrew unit is reordered by the bidi algorithm.
function numUnit(ctx: Ctx, num: string, unit: string, cx: number, y: number, numPx: number, unitPx: number) {
  ctx.direction = 'ltr';
  ctx.font = `900 ${numPx}px ${FONT}`;
  const nw = ctx.measureText(num).width;
  ctx.font = `700 ${unitPx}px ${FONT}`;
  ctx.direction = 'rtl';
  const uw = ctx.measureText(unit).width;
  const gap = unitPx * 0.35, total = nw + gap + uw, x0 = cx - total / 2;
  ctx.textAlign = 'left'; ctx.direction = 'ltr'; ctx.font = `900 ${numPx}px ${FONT}`;
  ctx.fillText(num, x0 + uw + gap, y);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.font = `700 ${unitPx}px ${FONT}`;
  ctx.fillText(unit, x0 + uw, y);
}

export function drawStory(cv: HTMLCanvasElement, scene: StoryScene, p: Pack, variant: Variant = 'full') {
  const { S, assets } = scene;
  const ctx = cv.getContext('2d')!, W = STORY_W, H = STORY_H, col = GROUP_HEX[p - 1];
  ctx.save();
  ctx.scale(cv.width / W, cv.height / H);
  ctx.clearRect(0, 0, W, H);
  const clear = S.bg === 'clear';
  const bgIm = S.bg === 'mine' && assets.myBg ? assets.myBg : assets.clubBg;
  if (!clear && bgIm) {
    cover(ctx, bgIm, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,.50)'); g.addColorStop(0.36, 'rgba(0,0,0,.06)');
    g.addColorStop(0.6, 'rgba(0,0,0,.06)'); g.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = clear ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18;

  if (S.layout === 'summary') drawSummary(ctx, scene, p, col, variant);
  else drawChartStory(ctx, scene, p, col, variant);
  ctx.restore();
}

function drawChartStory(ctx: Ctx, scene: StoryScene, p: Pack, col: string, variant: Variant) {
  const { S, sess, assets } = scene, W = STORY_W, H = STORY_H, cfg = S.packs[p];
  drawPill(ctx, scene, p, col);

  // Only the lines left on take space, so hiding labels/names pulls everything up.
  const label = (s: { title: string; who: string }) => [S.show.title && s.title, S.show.name && s.who].filter(Boolean).join(' · ');
  const sl = slots(S, sess, p);
  let y = S.show.pill ? 390 : 330;
  if (sl[0]) {
    numUnit(ctx, sl[0].value, '', W / 2, y, 210, 1);
    ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.font = `700 44px ${FONT}`;
    ctx.fillText(sl[0].unit, W / 2, y + 62);
    const l = label(sl[0]);
    if (l) { ctx.font = `700 38px ${FONT}`; ctx.fillText(l, W / 2, y + 122); }
    y += l ? 300 : 240;
  }
  if (sl[1]) {
    numUnit(ctx, sl[1].value, sl[1].unit, W / 2, y, 112, 42);
    const l = label(sl[1]);
    if (l) { ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.font = `700 38px ${FONT}`; ctx.fillText(l, W / 2, y + 62); }
    y += l ? 110 : 50;
  }
  const lg = logoImage(assets, S.logo.kind, S.logo.color);
  if (lg) {
    const [iw, ih] = dims(lg), lw = LOGO_KINDS[S.logo.kind].w, lh = (lw * ih) / iw;
    ctx.shadowBlur = S.logo.color === 'white' ? 10 : 0;
    ctx.drawImage(lg, W / 2 - lw / 2, y + 30, lw, lh);
    ctx.shadowBlur = 18;
  }

  const run = cfg.chart && variant !== 'noMap' ? chartRun(S, sess, p) : null;
  const cardH = 430, cardY = H - 110 - cardH, cardX = 110, cardW = W - 220;
  if (cfg.caption) {
    ctx.shadowBlur = 16; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText(cfg.caption, W / 2, run ? cardY - 60 : H - 200);
  }
  ctx.shadowBlur = 0;
  if (run) drawCard(ctx, scene, run, cardX, cardY, cardW, cardH);
}

/** The white "workout analysis" card with the lap bars. Shared by the story and the splits-only sticker. */
function drawCard(ctx: Ctx, scene: StoryScene, run: PackRun, cardX: number, cardY: number, cardW: number, cardH: number) {
  const { S, assets } = scene;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fff'; rr(ctx, cardX, cardY, cardW, cardH, 40); ctx.fill();
  ctx.restore();
  // The story's logo shape, always black: the card is white, so a white logo would vanish.
  let titleRight = cardX + cardW - 40;
  const hl = logoImage(assets, S.logo.kind, 'black');
  if (hl) {
    const [iw, ih] = dims(hl), lw = Math.min((60 * iw) / ih, 170);
    ctx.drawImage(hl, titleRight - lw, cardY + 34, lw, (lw * ih) / iw);
    titleRight -= lw + 20;
  }
  ctx.fillStyle = '#111'; ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.font = `800 44px ${FONT}`;
  ctx.fillText('ניתוח אימון', titleRight, cardY + 78);
  ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left'; ctx.direction = 'ltr'; ctx.font = `700 30px ${FONT}`;
  if (S.show.chartName) ctx.fillText(run.name, cardX + 40, cardY + 76);
  drawBars(ctx, run, cardX + 40, cardY + 120, cardW - 80, cardH - 160);
}

// The club's everyday story: route on top, date, logo, then one row of numbers.
function drawSummary(ctx: Ctx, scene: StoryScene, p: Pack, col: string, variant: Variant) {
  const { S, sess, assets } = scene, W = STORY_W, H = STORY_H, cfg = S.packs[p], run = chartRun(S, sess, p);
  drawPill(ctx, scene, p, col);
  if (cfg.chart && run?.route && variant !== 'noMap') {
    const pts = run.route, bw = 640, bh = 520, bx = (W - bw) / 2, by = S.show.pill ? 250 : 170;
    const mx = Math.max(...pts.map(q => q[0])), my = Math.max(...pts.map(q => q[1]));
    const sc = Math.min(bw / (mx || 1), bh / (my || 1));
    const ox = bx + (bw - mx * sc) / 2, oy = by + (bh - my * sc) / 2;
    const P = smoothRoute(pts).map(([x, y]) => [ox + x * sc, oy + y * sc] as [number, number]);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // Soft shadow, then a thin dark rim, then the white line: readable on sky and on white shirts alike.
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24; ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 17;
    routePath(ctx, P); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#fff'; ctx.lineWidth = 11;
    routePath(ctx, P); ctx.stroke();
    const dot = (q: [number, number], c: string) => {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q[0], q[1], 15, 0, 7); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(q[0], q[1], 10, 0, 7); ctx.fill();
    };
    dot(P[P.length - 1], '#ef4444'); dot(P[0], '#22c55e');
    ctx.restore();
  }
  let y = 900;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
  ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 16;
  if (S.show.date) {
    ctx.font = `700 44px ${FONT}`;
    ctx.fillText(sess.label.replace('אימון ', '').replace(' · ', ' '), W / 2, y);
    y += 40;
  }
  const lg = logoImage(assets, S.logo.kind, S.logo.color);
  if (lg) {
    const [iw, ih] = dims(lg), lw = Math.min(LOGO_KINDS[S.logo.kind].w * 1.2, 400), lh = (lw * ih) / iw;
    ctx.shadowBlur = S.logo.color === 'white' ? 10 : 0;
    ctx.drawImage(lg, W / 2 - lw / 2, y + 10, lw, lh);
    y += lh + 40;
    ctx.shadowBlur = 16;
  } else y += 30;
  // Numbers, the first one on the right as Hebrew reads.
  const sl = slots(S, sess, p), colW = 300, x0 = W / 2 + ((sl.length - 1) * colW) / 2;
  const labels = S.show.title;
  sl.forEach((s, i) => {
    const cx = x0 - i * colW;
    if (labels) { ctx.font = `700 34px ${FONT}`; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillText(s.title, cx, y + 40); }
    numUnit(ctx, s.value, s.unit || ' ', cx, y + (labels ? 118 : 80), 76, 30);
  });
  y += labels ? 150 : 110;
  const who = S.show.name ? sl.find(s => s.who)?.who : '';
  if (who) { ctx.font = `700 36px ${FONT}`; ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText(who, W / 2, y + 30); }
  if (cfg.caption) { ctx.font = `800 64px ${FONT}`; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillText(cfg.caption, W / 2, H - 260); }
}

// GPS jitters a few metres either way; a short centred moving average removes the
// zig-zag without rounding off real corners.
export function smoothRoute(pts: Array<[number, number]>): Array<[number, number]> {
  const w = 3, out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || i === pts.length - 1) { out.push(pts[i]); continue; }
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) { sx += pts[j][0]; sy += pts[j][1]; n++; }
    out.push([sx / n, sy / n]);
  }
  return out;
}

// Quadratic curves through the midpoints, so the line has no visible facets.
function routePath(ctx: Ctx, P: Array<[number, number]>) {
  ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length - 1; i++) {
    ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
  }
  ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
}

function drawPill(ctx: Ctx, { S, sess }: StoryScene, p: Pack, col: string) {
  if (!S.show.pill) return;
  const txt = S.layout === 'summary' ? `דבוקה ${p}` : `דבוקה ${p} · ${sess.label}`;
  ctx.save(); ctx.font = `800 38px ${FONT}`; ctx.direction = 'rtl';
  const pw = ctx.measureText(txt).width + 64;
  ctx.fillStyle = col; rr(ctx, (STORY_W - pw) / 2, 96, pw, 72, 36); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(txt, STORY_W / 2, 146);
  ctx.restore();
}

function drawBars(ctx: Ctx, run: PackRun, x: number, y: number, w: number, h: number) {
  const rows = run.laps.filter(([d, t]) => d >= 50 && t > 0);
  if (!rows.length) return;
  const total = rows.reduce((a, [, t]) => a + t, 0);
  const paces = rows.map(([d, t]) => (t / d) * 1000);
  const top = Math.max(150, Math.floor((Math.min(...paces) - 15) / 30) * 30);
  const bot = Math.min(480, Math.ceil((Math.max(...paces) + 15) / 30) * 30);
  const axisW = 86, cw = w - axisW, ch = h - 36, x0 = x + axisW;
  const Y = (pc: number) => y + ch - ((bot - Math.min(Math.max(pc, top), bot)) / (bot - top || 1)) * (ch - 10);
  ctx.font = `600 24px ${FONT}`; ctx.fillStyle = '#6b7280'; ctx.direction = 'ltr'; ctx.textAlign = 'left';
  const step = bot - top > 150 ? 60 : 30;
  for (let pc = top; pc <= bot; pc += step) ctx.fillText(fmtPace(pc), x, Y(pc) + 8);
  ctx.fillText('/km', x, y + h - 2);
  let cx = x0;
  rows.forEach(([, t], i) => {
    const bw = Math.max((cw * t) / total - 3, 3), pc = paces[i];
    // Dark = the hard parts: meaningfully faster than the run's own average.
    ctx.fillStyle = pc < run.pace - 12 ? '#1d4ed8' : '#93c5fd';
    const yy = Y(pc); rr(ctx, cx, yy, bw, y + ch - yy, 4); ctx.fill();
    cx += (cw * t) / total;
  });
  const ya = Y(run.pace);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5; ctx.setLineDash([12, 8]);
  ctx.beginPath(); ctx.moveTo(x0, ya); ctx.lineTo(x + w, ya); ctx.stroke(); ctx.setLineDash([]);
}

/** Splits sticker: the story's card plus room for its shadow. */
const CARD = { w: 860, h: 430, m: 60 };

/** A full-resolution export of one pack in one variant. */
export function renderExport(scene: StoryScene, p: Pack, variant: Variant): HTMLCanvasElement {
  const c = document.createElement('canvas');
  if (variant === 'splits') {
    c.width = CARD.w + CARD.m * 2; c.height = CARD.h + CARD.m * 2;
    const run = chartRun(scene.S, scene.sess, p, 'laps');
    if (run) drawCard(c.getContext('2d')!, scene, run, CARD.m, CARD.m - 10, CARD.w, CARD.h);
  } else {
    c.width = STORY_W; c.height = STORY_H;
    drawStory(c, scene, p, variant);
  }
  return c;
}

export const toPngBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
