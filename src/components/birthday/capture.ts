import { toCanvas } from 'html-to-image';

/**
 * One story slide as a 1080×1920 picture, for Instagram — captured from the slide itself
 * (html-to-image), so what is shared is exactly what was shown. The node is a still copy
 * of the slide laid out at 405×720 (9:16), with no animations and no controls on it.
 */
export const EXPORT_W = 405;
export const EXPORT_H = 720;

async function imagesReady(node: HTMLElement) {
  await Promise.all([...node.querySelectorAll('img')].map((img) =>
    img.complete && img.naturalWidth ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); })));
  await document.fonts.ready;
}

/**
 * `transparent`: a PNG with alpha (the weekly story's "רקע שקוף" — the card over one's own
 * photo in Instagram), else a JPEG on the story's dark blue.
 */
export async function captureSlide(node: HTMLElement, { transparent = false } = {}): Promise<Blob> {
  await imagesReady(node);
  const opts = {
    pixelRatio: 1080 / EXPORT_W, width: EXPORT_W, height: EXPORT_H, cacheBust: false, ...(transparent ? {} : { backgroundColor: '#060a52' }),
    // The copy lives off screen; in the picture it sits at the origin.
    style: { position: 'relative', left: '0', top: '0', inset: 'auto', zIndex: '0' },
  };
  // Safari draws the embedded pictures only from the second pass onward; the first one
  // warms its image cache. Cheap next to a blank share.
  const warm = await toCanvas(node, opts).catch(() => null);
  release(warm);
  const canvas = await toCanvas(node, opts);
  // JPEG: a dozen story pictures at PNG weight is ~30 MB through the share sheet.
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, transparent ? 'image/png' : 'image/jpeg', 0.92));
  release(canvas);
  if (!blob) throw new Error('capture failed');
  return blob;
}

/**
 * iOS Safari caps the memory of ALL canvases alive at once (a few hundred MB) and frees a
 * dropped one only at a garbage collection; past the cap a new canvas draws nothing and
 * toBlob returns null. Eight 1080×1920 slides, two passes each, crossed it — the video's
 * "לא הצלחנו להכין את הסרטון" (Ofer, 10-24). Shrinking a canvas to 0×0 frees it now.
 */
export function release(c: HTMLCanvasElement | null | undefined) {
  if (c) { c.width = 0; c.height = 0; }
}

/** Hand pictures to the phone's share sheet (Instagram, Save to Photos…), else download them. */
export async function shareImages(blobs: Blob[], base: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const files = blobs.map((b, i) => {
    const png = b.type === 'image/png';
    return new File([b], `${base}${blobs.length > 1 ? `-${i + 1}` : ''}.${png ? 'png' : 'jpg'}`, { type: png ? 'image/png' : 'image/jpeg' });
  });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
  }
  for (const [i, f] of files.entries()) {
    // Spaced out: a browser treats a burst of downloads as one and drops the rest.
    if (i) await new Promise((r) => setTimeout(r, 350));
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return 'downloaded';
}
