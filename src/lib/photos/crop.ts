/**
 * Face crop utility using sharp.
 *
 * Crops a single face from an image buffer using the bounding box returned by
 * Rekognition's DetectFaces. Adds ~25% padding on each side so the context
 * around the face is preserved — tight crops match poorly in similarity search.
 *
 * Output: JPEG buffer, max 512px on the long edge (keeps storage small).
 */

import sharp from 'sharp';
import type { FaceBoundingBox } from '@/lib/rekognition/client';

const MAX_SIZE = 512; // px — long edge cap

export async function cropFace(
  imageBuffer: Buffer,
  boundingBox: FaceBoundingBox
): Promise<Buffer> {
  const img = sharp(imageBuffer);
  const meta = await img.metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  if (!imgW || !imgH) throw new Error('Could not read image dimensions');

  // Convert relative (0-1) bounding box to pixel coords
  const faceLeft = boundingBox.left * imgW;
  const faceTop = boundingBox.top * imgH;
  const faceW = boundingBox.width * imgW;
  const faceH = boundingBox.height * imgH;

  // Add 25% padding on each side
  const pad = Math.max(faceW, faceH) * 0.25;
  const left = Math.max(0, Math.round(faceLeft - pad));
  const top = Math.max(0, Math.round(faceTop - pad));
  const right = Math.min(imgW, Math.round(faceLeft + faceW + pad));
  const bottom = Math.min(imgH, Math.round(faceTop + faceH + pad));

  const cropW = right - left;
  const cropH = bottom - top;

  return img
    .extract({ left, top, width: cropW, height: cropH })
    .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}
