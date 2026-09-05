'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Maximize2, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';

/**
 * The week's plan PDF, with zoom.
 *
 * It used to be `<iframe src={pdfUrl}>` — the browser's own PDF viewer. That gives
 * us no zoom control at all, and on iOS it is worse than that: Safari renders a PDF
 * in an iframe as a single static first page with no scrolling and no pinch. The
 * training plan is five pages of **A4 landscape** (842×595), so fit-to-width on a
 * 390pt phone squeezes a whole week's table into 275px of height. Unreadable, and
 * the only way out was "open in a new tab", which leaves the app.
 *
 * So pdf.js rasterises the pages onto canvases we own, and the zoom buttons are
 * real. 100% means fit-to-width, which is the width the container actually has —
 * so the control reads as "bigger / smaller than the page I'm looking at" rather
 * than as some absolute paper scale nobody can see.
 *
 * Only visible pages are rasterised (see PdfPage). At 300% a landscape A4 canvas is
 * ~15 MB; five of them held at once is how iOS Safari decides to throw the whole
 * tab away.
 */

/** Where `copy-pdf-worker.mjs` puts the worker on predev/prebuild. */
const WORKER_SRC = '/pdf.worker.min.mjs';

/**
 * The zoom ladder. Discrete steps, not a free-running slider: this is read with a
 * thumb on a phone, and a slider that lands on 137% is a worse experience than four
 * taps that land somewhere predictable.
 *
 * Stops at 3×. Beyond that a landscape A4 exceeds the canvas size iOS Safari will
 * hand back, and an oversized canvas comes back blank rather than erroring.
 */
const ZOOM_STEPS = [0.75, 1, 1.5, 2, 2.5, 3] as const;
const FIT_INDEX = ZOOM_STEPS.indexOf(1);

/** Hard ceiling on canvas pixels, well under the ~16.7M iOS gives up at. */
const MAX_CANVAS_PIXELS = 8_000_000;
/** And on either dimension — older iPhones cap a canvas edge at 4096. */
const MAX_CANVAS_EDGE = 4096;

interface Props {
  url: string;
  /** For the `<canvas>` fallback text and the iframe title. */
  title: string;
}

export function PlanPdfViewer({ url, title }: Props) {
  const t = useTranslations('program');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const [containerWidth, setContainerWidth] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  // Width of the scroller's content box, which is what "fit" is measured against.
  // Watched rather than read once: rotating the phone changes it, and a plan
  // rendered for the old width is either clipped or leaves half the screen empty.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    // The loading task, not the document: in pdf.js 6 `destroy()` lives here, and
    // it is also what has to be torn down if we unmount mid-parse.
    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        // Dynamic, so pdf.js (~350 KB gzipped, plus a 1.2 MB worker) is fetched
        // only by someone who actually opened a plan — it must not sit in the
        // shared chunk every screen in the app pays for.
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        task = pdfjs.getDocument({ url });
        const doc = await task.promise;
        if (cancelled) return;
        const loaded = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
        );
        if (cancelled) return;
        setPages(loaded);
        setState('ready');
      } catch {
        // A missing worker, a moved file, a PDF pdf.js won't parse — all land here,
        // and all get the browser's own viewer instead of an error screen.
        if (!cancelled) setState('failed');
      }
    })();

    return () => {
      cancelled = true;
      // Frees the worker and every page's cached operator list.
      task?.destroy();
    };
  }, [url]);

  const zoom = ZOOM_STEPS[zoomIndex];
  const canOut = zoomIndex > 0;
  const canIn = zoomIndex < ZOOM_STEPS.length - 1;

  const step = useCallback((delta: number) => {
    setZoomIndex(i => Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta)));
  }, []);

  const header = (
    <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-page/60">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-ink-400" />
        <span className="truncate text-sm font-medium">{title}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('openInNewTab')}</span>
      </a>
    </div>
  );

  if (state === 'failed') {
    return (
      <div className="bg-card/60 rounded-card border border-page/60 overflow-hidden">
        {header}
        <div className="w-full" style={{ height: '80vh' }}>
          <iframe src={url} className="w-full h-full border-0" title={title} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card/60 rounded-card border border-page/60 overflow-hidden">
      {header}

      {/* The zoom bar. Its own row under the title rather than crowded in beside
          the new-tab link: on a 320pt screen a title, a link and three controls in
          one row is how the title ends up two characters wide. */}
      <div className="flex items-center justify-center gap-1 px-4 sm:px-5 py-2 border-b border-page/60 bg-card/40">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={!canOut}
          aria-label={t('zoomOut')}
          className={cn(
            'grid place-items-center w-11 h-11 rounded-xl transition-colors',
            canOut ? 'text-ink-700 active:bg-page' : 'text-ink-300 cursor-not-allowed',
          )}
        >
          <Minus className="h-4 w-4" />
        </button>

        {/* dir="ltr" and tabular-nums: a percentage is not RTL text, and without
            fixed-width digits the label jitters the buttons sideways on every tap. */}
        <button
          type="button"
          onClick={() => setZoomIndex(FIT_INDEX)}
          disabled={zoomIndex === FIT_INDEX}
          aria-label={t('zoomFit')}
          className={cn(
            'inline-flex items-center gap-1.5 min-w-[92px] h-11 justify-center rounded-xl px-3 text-xs font-bold transition-colors',
            zoomIndex === FIT_INDEX ? 'text-ink-400' : 'text-ink-700 active:bg-page',
          )}
        >
          <Maximize2 className="h-3.5 w-3.5 shrink-0" />
          <span dir="ltr" className="tabular-nums">{Math.round(zoom * 100)}%</span>
        </button>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={!canIn}
          aria-label={t('zoomIn')}
          className={cn(
            'grid place-items-center w-11 h-11 rounded-xl transition-colors',
            canIn ? 'text-ink-700 active:bg-page' : 'text-ink-300 cursor-not-allowed',
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        // Scrolls in both axes because zoomed-in pages are wider than the screen.
        // `overscroll-contain` stops a swipe that runs out of plan from carrying on
        // into the page behind it, which on a phone reads as the app jumping.
        className="w-full overflow-auto overscroll-contain bg-page/40 p-2 sm:p-4"
        style={{ height: '80vh' }}
      >
        {state === 'loading' ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {pages.map((page, i) => (
              <PdfPage
                key={page.pageNumber}
                page={page}
                containerWidth={containerWidth}
                zoom={zoom}
                scroller={scrollRef}
                label={t('pdfPageOf', { page: i + 1, total: pages.length })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One page, rasterised only while it is near the viewport.
 *
 * The placeholder is sized from the page's own aspect ratio before anything is
 * drawn, so the scroller's height is right from the first paint — otherwise every
 * page that rasterises shoves the ones below it down and reading page 3 means
 * chasing it up the screen.
 */
function PdfPage({
  page,
  containerWidth,
  zoom,
  scroller,
  label,
}: {
  page: PDFPageProxy;
  containerWidth: number;
  zoom: number;
  scroller: React.RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  const base = page.getViewport({ scale: 1 });
  // Fit the page's width to the container, then apply the user's zoom on top. The
  // 8px allows for the scroller's padding without a second measurement.
  const fit = containerWidth > 0 ? (containerWidth - 8) / base.width : 0;
  const cssW = Math.max(1, Math.floor(base.width * fit * zoom));
  const cssH = Math.max(1, Math.floor(base.height * fit * zoom));

  // A generous margin: pages one screen away are drawn before they're scrolled to,
  // so normal reading never waits, and pages further off are released.
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => setNear(entries.some(e => e.isIntersecting)),
      { root: scroller.current, rootMargin: '150% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scroller]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !near || fit <= 0) return;

    // Draw at device resolution so text is sharp, but cap it: a 3× landscape A4 at
    // DPR 3 is past what iOS Safari will allocate, and an over-large canvas comes
    // back blank rather than throwing something we could catch.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wanted = fit * zoom * dpr;
    const ceiling = Math.min(
      MAX_CANVAS_EDGE / base.width,
      MAX_CANVAS_EDGE / base.height,
      Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)),
    );
    const viewport = page.getViewport({ scale: Math.min(wanted, ceiling) });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const task = page.render({ canvas, viewport });
    // Cancelling a render rejects its promise; that is the normal path when zoom
    // changes mid-draw and is not an error.
    task.promise.catch(() => {});
    return () => task.cancel();
  }, [page, near, fit, zoom, cssW, cssH, base.width, base.height]);

  // Released when the page scrolls far away, so five zoomed-in pages don't sit in
  // memory at once.
  useEffect(() => {
    if (near) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [near]);

  return (
    <div
      ref={holderRef}
      className="shrink-0 rounded-lg bg-white shadow-sm overflow-hidden"
      style={{ width: cssW, height: cssH }}
    >
      <canvas ref={canvasRef} aria-label={label} className="block" />
    </div>
  );
}
