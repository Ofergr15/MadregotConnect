// The PDF's own text layer as positioned glyphs, for lib/plans/verify/compare.ts.
// Server only: pdfjs-dist's legacy build runs in Node without a worker or canvas.
// y is measured from the top of the page, in PDF points.

import type { PdfGlyph } from './compare';

export async function pdfGlyphs(bytes: Uint8Array): Promise<PdfGlyph[]> {
  // The worker, loaded here in-process: pdfjs's "fake worker" in Node picks it up
  // from globalThis.pdfjsWorker instead of importing it by path at runtime — a
  // path the serverless file trace would not have followed.
  // @ts-expect-error — pdfjs-dist ships no types for the worker entry.
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const out: PdfGlyph[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
        if (!it.str || !it.transform) continue;
        out.push({ page: p, x: it.transform[4], y: vp.height - it.transform[5], w: it.width ?? 0, str: it.str, pageWidth: vp.width });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return out;
}
