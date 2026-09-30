import {
  STORY_W, STORY_H, drawCover, loadImage, resolveFontStack, roundRectPath,
  type ShareBrand,
} from '@/lib/feed/share-image';
import type { Last7Report, WellnessNight } from './last-7-days';
import {
  LOOK_BRAND, WEEK_STORY_TEXT, bodyDelta, nightlySleep, numberValue,
  type WeekLook, type WeekNumberKey, type WeekStoryState,
} from './week-story';
import { recordHitMap, type ShareHitMap } from '@/lib/share/hit-map';

/**
 * The weekly story, one of five looks, as a 1080×1920 image.
 *
 * Every size here is the approved mockup's (a 270×480 card) times four, so the
 * picture the athlete posts is the one that was signed off, not a reading of it.
 * The preview in the editor is this same image: there is no HTML copy of the card
 * that could drift from the file.
 */
const S = 4;
const PAD_X = 20 * S;
const PAD_TOP = 30 * S;
const PAD_BOTTOM = 30 * S;
const INNER_W = STORY_W - PAD_X * 2;

export const BRAND_SRC: Record<ShareBrand, string> = {
  badge: '/images/logo-white.png',
  wordmark: '/images/wordmark-white.png',
  stairs: '/images/stairs-white.png',
};
const CLUB_PHOTO = '/images/runners-group.jpg';

export interface WeekStoryInput {
  report: Last7Report;
  previous?: Last7Report | null;
  nights?: WellnessNight[];
  athleteName?: string | null;
  photo?: Blob | null;
  state: WeekStoryState;
  /** Draw a different look with the same state, for the looks strip. */
  look?: WeekLook;
  /** Where the logo, the text and the numbers landed, so the editor can make them tappable. */
  onHitMap?: (map: ShareHitMap) => void;
}

export async function renderWeekStory(input: WeekStoryInput): Promise<Blob> {
  await document.fonts.ready;
  const font = resolveFontStack();
  const { report, state } = input;
  const look = input.look ?? state.look;
  const lang = state.lang;
  const rtl = lang === 'he';
  const text = WEEK_STORY_TEXT[lang];
  const picks = state.picks[look];
  const transparent = state.background === 'sticker';

  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.direction = rtl ? 'rtl' : 'ltr';

  await drawBackground(ctx, state.background, input.photo ?? null);

  const range = rtl
    ? `${fd(report.to)} – ${fd(report.from)}`
    : `${fd(report.from)} – ${fd(report.to)}`;

  const brand = state.brand ?? LOOK_BRAND[look];
  let logo: HTMLImageElement | null = null;
  try { logo = await loadImage(BRAND_SRC[brand]); } catch {}
  // Wordmark 17px tall in the mockup, the two marks 34px.
  const logoH = (brand === 'wordmark' ? 17 : 34) * S;
  const logoW = logo ? (logo.naturalWidth / logo.naturalHeight) * logoH : 0;
  const drawLogo = (cy: number) => {
    if (logo) ctx.drawImage(logo, (STORY_W - logoW) / 2, cy, logoW, logoH);
    return cy + logoH;
  };

  const fill = (alpha = 1) => { ctx.fillStyle = `rgba(255,255,255,${alpha})`; };
  const put = (s: string, x: number, y: number, weight: number, size: number, alpha = 1) => {
    ctx.font = `${weight} ${size}px ${font}`;
    fill(alpha);
    ctx.fillText(s, x, y);
  };
  // Numbers print left-to-right whatever the card's language: "5:21" is not "12:5".
  const num = (s: string, x: number, y: number, weight: number, size: number, alpha = 1) => {
    ctx.save();
    ctx.direction = 'ltr';
    put(s, x, y, weight, size, alpha);
    ctx.restore();
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Watched from here, after the background: the logo, the title and the dates,
  // and the rest as the numbers. The name line at the foot is drawn after the
  // watch stops: counted as text it would stretch the text's box over the whole
  // card, and a tap on the numbers would open the title.
  const stopHitMap = input.onHitMap
    ? recordHitMap(ctx, { isMark: img => img === logo, title: state.title, date: range, width: STORY_W, height: STORY_H })
    : null;
  let stopped = false;
  const finishHitMap = () => {
    if (!stopHitMap || stopped) return;
    stopped = true;
    input.onHitMap!(stopHitMap());
  };

  const drawText = (y: number) => {
    let cy = y;
    if (state.title.trim()) { cy += 21 * S; put(state.title.trim(), STORY_W / 2, cy, 900, 21 * S); }
    if (state.dates) { cy += 16 * S; num(range, STORY_W / 2, cy, 500, 11 * S, 0.7); }
    return cy;
  };
  const drawName = () => {
    finishHitMap();
    if (!state.name) return;
    const who = input.athleteName?.trim();
    put(who ? `${who} · madregot.app` : 'madregot.app', STORY_W / 2, STORY_H - PAD_BOTTOM, 500, 10.5 * S, 0.75);
  };
  // One grid row of number cells; in RTL the first pick sits on the right.
  const cells = (keys: WeekNumberKey[], cols: number, y: number, valueSize: number, width = INNER_W, x0 = PAD_X) => {
    const w = width / cols;
    keys.forEach((k, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = rtl ? x0 + width - w * (col + 0.5) : x0 + w * (col + 0.5);
      const cy = y + row * (valueSize + 24 * S);
      num(numberValue(report, k), cx, cy + valueSize * 0.8, 900, valueSize);
      // A label wider than its cell breaks at a space onto a second line rather
      // than running into the next one ("דופק מנוחה ממוצע" in a row of four).
      ctx.font = `500 ${10 * S}px ${font}`;
      const label = text.labels[k];
      const words = label.split(' ');
      let lines = [label];
      if (words.length > 1 && ctx.measureText(label).width > w - 6 * S) {
        const cut = Math.ceil(words.length / 2);
        lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
      }
      lines.forEach((l, li) => put(l, cx, cy + valueSize * 0.8 + 14 * S + li * 12 * S, 500, 10 * S, 0.72));
    });
  };

  if (look === 'totals') {
    let y = drawLogo(PAD_TOP);
    y = drawText(y + 22 * S);
    y += 28 * S;
    const top = picks.slice(0, 4);
    const rest = picks.slice(4, 8);
    cells(top, 2, y, 31 * S);
    y += Math.ceil(top.length / 2) * (31 * S + 24 * S) - 10 * S;
    if (rest.length) {
      y += 20 * S;
      fill(0.2);
      ctx.fillRect(PAD_X, y, INNER_W, S / 2);
      y += 14 * S;
      cells(rest, 4, y, 15 * S);
    }
    drawName();
  } else if (look === 'days') {
    let y = drawLogo(PAD_TOP);
    y = drawText(y + 18 * S);
    y += 24 * S;
    drawDays(ctx, font, input, text, y, rtl);
    y += (150 + (state.sleepStrip ? 30 : 17) + 20) * S;
    cells(picks.slice(0, 3), 3, y, 18 * S);
    drawName();
  } else if (look === 'bar') {
    let y = drawText(PAD_TOP);
    drawLogo(y + 10 * S);
    const barH = 50 * S;
    const by = STORY_H - PAD_BOTTOM - barH;
    ctx.fillStyle = 'rgba(10,12,30,0.55)';
    roundRectPath(ctx, PAD_X, by, INNER_W, barH, 12 * S);
    ctx.fill();
    y = by + 9 * S;
    cells(picks.slice(0, 4), 4, y, 16 * S, INNER_W - 8 * S, PAD_X + 4 * S);
  } else if (look === 'body') {
    let y = drawLogo(PAD_TOP);
    y = drawText(y + 18 * S);
    y += 24 * S;
    const tiles = (['sleep', 'rhr'] as const).filter(k => k === 'sleep' ? !!report.sleepSeconds : !!report.restingHr);
    const gap = 8 * S;
    const tw = (INNER_W - gap) / 2;
    const th = 70 * S;
    tiles.forEach((k, i) => {
      const tx = rtl ? PAD_X + INNER_W - tw * (i + 1) - gap * i : PAD_X + (tw + gap) * i;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRectPath(ctx, tx, y, tw, th, 12 * S);
      ctx.fill();
      ctx.save();
      ctx.textAlign = rtl ? 'right' : 'left';
      const ix = rtl ? tx + tw - 10 * S : tx + 10 * S;
      put(text.labels[k], ix, y + 18 * S, 500, 9.5 * S, 0.75);
      num(numberValue(report, k), ix, y + 44 * S, 900, 22 * S);
      const d = state.deltas ? bodyDelta(report, input.previous, k) : null;
      if (d) {
        ctx.font = `800 ${9.5 * S}px ${font}`;
        ctx.fillStyle = d.good ? '#7CF5C4' : '#FFB3B3';
        // The number and its words drawn apart: one mixed string lets the bidi
        // algorithm move the minus sign to the wrong end.
        ctx.save(); ctx.direction = 'ltr';
        ctx.fillText(d.text, ix, y + 60 * S);
        ctx.restore();
        const dw = ctx.measureText(d.text).width + 4 * S;
        ctx.fillText(text.fromLastWeek, rtl ? ix - dw : ix + dw, y + 60 * S);
      }
      ctx.restore();
    });
    y += th + 24 * S;
    cells(picks.slice(0, 2), 2, y, 31 * S);
    drawName();
  } else {
    const k = picks[0] ?? 'km';
    const bigSize = 84 * S;
    const block = bigSize * 0.95 + 20 * S + 22 * S + logoH;
    const top = (STORY_H - block) / 2;
    num(numberValue(report, k), STORY_W / 2, top + bigSize * 0.8, 900, bigSize);
    put(`${text.labels[k]} ${text.thisWeek}`, STORY_W / 2, top + bigSize * 0.95 + 16 * S, 500, 13 * S, 0.8);
    drawLogo(top + bigSize * 0.95 + 20 * S + 22 * S);
  }

  // The looks without a name line are done here; a second call finds nothing to stop.
  finishHitMap();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      transparent ? 'image/png' : 'image/jpeg',
      0.92,
    );
  });
}

const fd = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

async function drawBackground(ctx: CanvasRenderingContext2D, bg: WeekStoryState['background'], photo: Blob | null) {
  if (bg === 'sticker') return;
  if (bg === 'photo') {
    try {
      const src = photo ? await createImageBitmap(photo) : await loadImage(CLUB_PHOTO);
      const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
      const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
      drawCover(ctx, src, w, h);
      // The mockup's shade: the numbers sit on a darker lower half.
      const g = ctx.createLinearGradient(0, 0, 0, STORY_H);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STORY_W, STORY_H);
      return;
    } catch {
      // A photo that fails to decode falls through to the club colours.
    }
  }
  const stops: Record<'club' | 'sunset' | 'night', [number, string][]> = {
    club: [[0, '#2f45ff'], [0.45, '#1f22b8'], [1, '#1b1150']],
    sunset: [[0, '#FF8A3D'], [0.45, '#FF5315'], [1, '#8a1f3d']],
    night: [[0, '#23263a'], [1, '#0b0d1d']],
  };
  const key = bg === 'photo' ? 'club' : bg;
  // 160deg: from the top, leaning slightly to the right.
  const g = ctx.createLinearGradient(STORY_W * 0.33, 0, STORY_W * 0.67, STORY_H);
  for (const [at, c] of stops[key]) g.addColorStop(at, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  if (key === 'club') {
    const light = (x: number, y: number, r: number, c: string) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, STORY_W, STORY_H);
    };
    light(STORY_W * 0.9, -STORY_H * 0.1, STORY_W * 1.1, 'rgba(255,255,255,0.25)');
    light(0, STORY_H * 1.1, STORY_W * 0.9, 'rgba(93,255,208,0.2)');
  }
}

/** The seven bars, the sleep strip under them and the average line. */
function drawDays(
  ctx: CanvasRenderingContext2D,
  font: string,
  input: WeekStoryInput,
  text: (typeof WEEK_STORY_TEXT)['he'],
  top: number,
  rtl: boolean,
) {
  const { report, state } = input;
  const isKm = state.chartMetric === 'km';
  const values = report.days.map(d => (isKm ? d.km : d.seconds / 60));
  const max = Math.max(...values, 0.0001);
  const sleep = nightlySleep(report, input.nights);
  const gutter = state.avgLine ? 40 * S : 0;
  const x0 = PAD_X + 4 * S + (rtl ? 0 : gutter);
  const width = INNER_W - 8 * S - gutter;
  const gap = 6 * S;
  const bw = (width - gap * 6) / 7;
  const barMax = 112 * S;
  const labelsY = top + 150 * S;
  const stripH = state.sleepStrip ? 4 * S + 3 * S : 0;
  const base = labelsY - 9.5 * S - 3 * S - stripH;
  const fmt = (v: number) => (isKm ? String(Math.round(v * 10) / 10) : `${Math.round(v)}${text.minutes}`);

  ctx.save();
  ctx.textAlign = 'center';
  values.forEach((v, i) => {
    const slot = rtl ? 6 - i : i;
    const bx = x0 + slot * (bw + gap);
    const cx = bx + bw / 2;
    const h = v > 0 ? Math.max(3 * S, (v / max) * barMax) : 3 * S;
    ctx.fillStyle = v > 0 ? '#ffffff' : 'rgba(255,255,255,0.25)';
    roundRectPath(ctx, bx, base - h, bw, h, v > 0 ? 5 * S : 2 * S);
    ctx.fill();
    if (v > 0 && state.barValues) {
      ctx.font = `800 ${9.5 * S}px ${font}`;
      ctx.fillStyle = '#fff';
      ctx.save(); ctx.direction = 'ltr';
      ctx.fillText(fmt(v), cx, base - h - 3 * S);
      ctx.restore();
    }
    if (state.sleepStrip) {
      const s = sleep[i];
      const sy = base + 3 * S;
      if (s == null) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let dx = 0; dx < bw; dx += 4 * S) ctx.fillRect(bx + dx, sy, Math.min(2 * S, bw - dx), 4 * S);
      } else {
        const hours = s / 3600;
        ctx.globalAlpha = Math.max(0.3, Math.min(1, (hours - 5) / 3));
        ctx.fillStyle = '#B7ACFF';
        roundRectPath(ctx, bx, sy, bw, 4 * S, 2 * S);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.font = `700 ${9.5 * S}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(text.days[report.days[i].weekday], cx, labelsY);
  });

  if (state.avgLine) {
    const avg = values.reduce((a, b) => a + b, 0) / 7;
    const ly = base - (avg / max) * barMax;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5 * S;
    ctx.setLineDash([4 * S, 3 * S]);
    ctx.beginPath();
    ctx.moveTo(x0, ly);
    ctx.lineTo(x0 + width, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    // The number in the gutter beside the line, never on a bar.
    const gx = rtl ? PAD_X + INNER_W - gutter / 2 : PAD_X + gutter / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRectPath(ctx, gx - 18 * S, ly - 11 * S, 36 * S, 22 * S, 6 * S);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${10 * S}px ${font}`;
    ctx.save(); ctx.direction = 'ltr';
    ctx.fillText(fmt(avg), gx, ly + 1 * S);
    ctx.restore();
    ctx.font = `600 ${7.5 * S}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(text.average, gx, ly + 9 * S);
  }

  if (state.sleepStrip) {
    ctx.font = `500 ${9 * S}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(text.sleepLegend, STORY_W / 2, labelsY + 18 * S);
  }
  ctx.restore();
}
