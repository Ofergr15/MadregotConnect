/**
 * The whole year story as one 1080×1920 video for an Instagram story (Ofer, 2026-10-18;
 * mockup ~/.cache/madregot/birthday-year/video-mockup.html). The slides are the same
 * still pictures the share buttons make (capture.ts); here they are played one after
 * another on a canvas — each slides in, then zooms in slowly — and the canvas is recorded
 * with MediaRecorder. Recording runs in real time, so preparing takes about as long as
 * the video. No music: Instagram adds its own, and mutes a story with ours in it.
 */

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
export const SLIDE_MS = 3000;
export const LAST_MS = 4000;
export const ENTER_MS = 450;
const ZOOM = 0.04;
const FPS = 30;

export const videoLength = (slides: number) => (slides <= 0 ? 0 : (slides - 1) * SLIDE_MS + LAST_MS);

export interface Frame {
  /** The slide on screen. */
  i: number;
  /** 0→1 while it slides in over the one before; 1 once it is in. */
  enter: number;
  /** 0→1 across the slide's own time, for the slow zoom. */
  through: number;
}

/** What is on screen `t` ms into a video of `n` slides. Pure, so the timing is testable. */
export function frameAt(t: number, n: number): Frame {
  if (n <= 0) return { i: 0, enter: 1, through: 0 };
  const total = videoLength(n);
  const at = Math.max(0, Math.min(t, total));
  const i = Math.min(n - 1, Math.floor(at / SLIDE_MS));
  const local = at - i * SLIDE_MS;
  const dur = i === n - 1 ? LAST_MS : SLIDE_MS;
  return { i, enter: i === 0 ? 1 : Math.min(1, local / ENTER_MS), through: Math.min(1, local / dur) };
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/** MP4 where the phone records it (Safari, recent Chrome) — Instagram wants MP4; else WebM. */
export function videoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export const canRecordVideo = () =>
  typeof document !== 'undefined' && !!videoMime() && typeof HTMLCanvasElement.prototype.captureStream === 'function';

function draw(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, zoom: number) {
  const w = VIDEO_W * zoom, h = VIDEO_H * zoom;
  ctx.drawImage(img, x + (VIDEO_W - w) / 2, (VIDEO_H - h) / 2, w, h);
}

function paint(ctx: CanvasRenderingContext2D, frames: CanvasImageSource[], f: Frame) {
  ctx.fillStyle = '#060a52';
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  // The story runs right to left: the next slide comes in from the left edge.
  const e = easeOut(f.enter);
  if (e < 1 && f.i > 0) draw(ctx, frames[f.i - 1], VIDEO_W * e, 1 + ZOOM);
  draw(ctx, frames[f.i], -VIDEO_W * (1 - e), 1 + ZOOM * f.through);
}

/**
 * A slide picture, decoded as an <img> rather than an ImageBitmap: on iOS a bitmap is
 * counted against the canvas memory cap (see capture.ts `release`), an image is not.
 */
export async function blobImage(blob: Blob): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  try { await img.decode(); } catch { await new Promise<void>((r, j) => { img.onload = () => r(); img.onerror = () => j(new Error('image decode failed')); }); }
  return img;
}

/** Why a video failed, for the bug board (kind 'error' via the reporter's crash channel). */
export function reportVideoFail(where: string, phase: string, err: unknown) {
  const e = err as { name?: string; message?: string };
  try { window.dispatchEvent(new CustomEvent('mc:crash', { detail: `story video (${where}) ${phase}: ${e?.name || 'Error'}: ${String(e?.message || err).slice(0, 160)}` })); } catch { /* never the bug */ }
}

/** Plays `frames` on a canvas and records it. `onProgress` gets 0→1. */
export async function recordStory(frames: CanvasImageSource[], opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<Blob> {
  const mime = videoMime();
  if (!mime || frames.length === 0) throw new Error('video not supported');
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  // In the page (invisible): Safari is surest to feed a captured stream from a canvas it lays out.
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', left: '-10px', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); throw new Error('no canvas'); }
  paint(ctx, frames, frameAt(0, frames.length));

  const stream = canvas.captureStream(FPS);
  // The bitrate is a hint some encoders refuse; without it the phone picks its own.
  let rec: MediaRecorder;
  try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }); } catch { rec = new MediaRecorder(stream, { mimeType: mime }); }
  const chunks: Blob[] = [];
  rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); rec.onerror = () => r(); });
  rec.start(500);

  const total = videoLength(frames.length);
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) return reject(new DOMException('cancelled', 'AbortError'));
      const t = performance.now() - start;
      paint(ctx, frames, frameAt(t, frames.length));
      opts.onProgress?.(Math.min(1, t / total));
      // One more frame past the end, so the last picture is in the file.
      if (t >= total + 1000 / FPS) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => {
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach((tr) => tr.stop());
  });
  await stopped;
  canvas.remove();
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (!blob.size) throw new Error('empty recording');
  return blob;
}

/** The phone's share sheet (Instagram, WhatsApp, Save Video), else a download. */
export async function shareVideo(blob: Blob, base: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `${base}.${ext}`, { type: blob.type });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
