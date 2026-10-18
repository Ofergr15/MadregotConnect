import { STORY_H, STORY_W, resolveFontStack, roundRectPath, shareCard } from '@/lib/feed/share-image';
import type { BirthdayStory } from '@/lib/birthday-year/server';

/**
 * The story's last screen as a 1080×1920 picture for Instagram: the same poster — photo,
 * "השנה של <name>", the kilometres, six numbers, the mark. Drawn on a canvas rather than
 * captured, so it is sharp at story size. Numbers are drawn as their own left-to-right runs
 * and the Hebrew unit placed beside them, never one mixed string (the share cards' rule).
 */

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // The photos are on the public storage bucket; without this the canvas taints and
    // refuses to export.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const dmy = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}`;

export async function renderPoster(story: BirthdayStory, photo: string | null, grid: Array<[string, string, boolean?]>): Promise<Blob> {
  await document.fonts.ready;
  const font = resolveFontStack();
  const c = document.createElement('canvas');
  c.width = STORY_W;
  c.height = STORY_H;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H);
  bg.addColorStop(0, '#0a1080');
  bg.addColorStop(1, '#060a3c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const [img, wm] = await Promise.all([photo ? load(photo) : Promise.resolve(null), load('/images/wordmark-white.png')]);
  const X = 70, Y = 170, W = STORY_W - 140, H = 1560, R = 84;
  ctx.save();
  roundRectPath(ctx, X, Y, W, H, R);
  ctx.clip();
  const card = ctx.createLinearGradient(0, Y, 0, Y + H);
  card.addColorStop(0, '#0d16a8');
  card.addColorStop(1, '#070c5e');
  ctx.fillStyle = card;
  ctx.fillRect(X, Y, W, H);
  const PH = 760;
  if (img) {
    const s = Math.max(W / img.width, PH / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, X + (W - w) / 2, Y + (PH - h) * 0.2, w, h);
  }
  const fade = ctx.createLinearGradient(0, Y, 0, Y + PH);
  fade.addColorStop(0.35, 'rgba(13,22,168,0)');
  fade.addColorStop(0.85, 'rgba(13,22,168,0.88)');
  fade.addColorStop(1, '#0d16a8');
  ctx.fillStyle = fade;
  ctx.fillRect(X, Y, W, PH);
  ctx.restore();

  const right = X + W - 60;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFB08F';
  ctx.font = `800 40px ${font}`;
  ctx.fillText('השנה של', right, Y + PH - 200);
  ctx.fillStyle = '#fff';
  ctx.font = `900 132px ${font}`;
  ctx.fillText(story.name, right, Y + PH - 70);
  ctx.globalAlpha = 0.8;
  ctx.font = `600 34px ${font}`;
  ctx.fillText(`מ־${dmy(story.stats.from)} עד ${dmy(story.stats.to)}`, right, Y + PH - 18);
  ctx.globalAlpha = 1;

  // The kilometres: the number flush right, the unit after it on the left.
  const kmY = Y + PH + 200;
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.font = `900 190px ${font}`;
  const kmText = story.stats.km.toLocaleString('en-US');
  ctx.fillText(kmText, right, kmY);
  const kmW = ctx.measureText(kmText).width;
  ctx.direction = 'rtl';
  ctx.fillStyle = '#FFB08F';
  ctx.font = `800 58px ${font}`;
  ctx.fillText('ק״מ', right - kmW - 22, kmY);

  // Six numbers, three by two, under a hairline.
  const gx = X + 40, gw = W - 80, top = kmY + 70, rowH = 190;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(gx, top, gw, 2);
  grid.slice(0, 6).forEach(([value, label, ltr], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const cx = gx + gw - (col + 0.5) * (gw / 3);
    const cy = top + row * rowH;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.direction = ltr ? 'ltr' : 'rtl';
    ctx.font = `900 64px ${font}`;
    ctx.fillText(value, cx, cy + 96);
    ctx.direction = 'rtl';
    ctx.globalAlpha = 0.75;
    ctx.font = `600 32px ${font}`;
    ctx.fillText(label, cx, cy + 146);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(gx, cy + rowH - 1, gw, 2);
  });

  const footY = Y + H - 70;
  if (wm) {
    const w = 250, h = (wm.height / wm.width) * w;
    ctx.drawImage(wm, X + 60, footY - h + 10, w, h);
  }
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFD2BF';
  ctx.font = `800 36px ${font}`;
  ctx.fillText('🎂 מזל טוב מכל המדרגות', right, footY);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92));
}

export async function sharePoster(story: BirthdayStory, photo: string | null, grid: Array<[string, string, boolean?]>) {
  const blob = await renderPoster(story, photo, grid);
  return shareCard(blob, `madregot-year-${story.birthday}.jpg`);
}
