'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Maximize2, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  canZoom,
  clampZoom,
  FIT_ZOOM,
  renderScale,
  stepZoom,
  zoomAnchor,
} from '@/lib/pdf/zoom';
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist';

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
 * So pdf.js rasterises the pages onto canvases we own, and the zoom is ours too:
 *
 *  - **Pinch works.** It didn't before, and there was no fallback: page-level pinch
 *    is left enabled in the viewport config, but iOS gives an INSTALLED PWA no page
 *    zoom at all, so the buttons were the only zoom in the app. Two fingers here are
 *    handled directly, on a non-passive listener — React attaches `touchmove`
 *    passively at the root, so a React `onTouchMove` prop cannot call
 *    `preventDefault` and the browser pans the scroller out from under the gesture.
 *  - **The point under the fingers stays put** (`zoomAnchor`). Zooming from the
 *    top-left corner slides the day you were reading off the screen.
 *  - **A zoom can no longer blank a page.** Each tap used to start a new
 *    `page.render()` on a canvas whose previous render was still cancelling; pdf.js
 *    refuses a second render on a canvas in use, and the rejection was swallowed by
 *    a bare `.catch(() => {})`, so the page just went white. Renders are serialised
 *    per page now: cancel, *await* the cancellation, then draw.
 *  - **The bitmap lags the layout on purpose.** `zoom` resizes the page instantly so
 *    the gesture tracks the fingers; `renderZoom` follows once the pinch settles, so
 *    a pinch rasterises once at its final scale instead of forty times on the way.
 *
 * Only visible pages are rasterised (see PdfPage). At 300% a landscape A4 canvas is
 * ~32 MB; five of them held at once is how iOS Safari decides to throw the whole
 * tab away.
 */

/** Where `copy-pdf-worker.mjs` puts the worker on predev/prebuild. */
const WORKER_SRC = '/pdf.worker.min.mjs';

/**
 * How long after the last zoom change the pages are redrawn at the new scale.
 *
 * Long enough that a pinch (a touchmove every frame) and a double tap on "+" each
 * rasterise once, short enough that letting go feels like it sharpened immediately.
 */
const RERENDER_DELAY_MS = 140;

/** Two taps closer together than this, near the same spot, are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 32;
/** What a double tap zooms to when the page is at fit. */
const DOUBLE_TAP_ZOOM = 2;

interface Props {
  url: string;
  /** For the `<canvas>` fallback text and the iframe title. */
  title: string;
}

export function PlanPdfViewer({ url, title }: Props) {
  const t = useTranslations('program');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  // The size the pages are LAID OUT at, and the size their bitmaps are drawn at.
  // They are the same number at rest and diverge only while a gesture is running.
  const [zoom, setZoom] = useState(FIT_ZOOM);
  const [renderZoom, setRenderZoom] = useState(FIT_ZOOM);
  // The gesture handlers are attached once and must not be re-attached on every
  // zoom change, so they read the current zoom from here rather than from state.
  const zoomRef = useRef(FIT_ZOOM);

  // Width of the scroller's content box, which is what "fit" is measured against.
  // Watched rather than read once: rotating the phone changes it, and a plan
  // rendered for the old width is either clipped or leaves half the screen empty.
  //
  // The content box specifically, not `clientWidth` — clientWidth *includes*
  // padding, and this scroller has `p-2 sm:p-4`. The old code compensated with a
  // hardcoded 8px subtraction downstream, which was short by 8px on mobile and
  // 24px on desktop, so "fit to width" reliably overflowed and put a horizontal
  // scrollbar on a page that was supposed to fit exactly. `contentRect` is that
  // measurement rather than an approximation of it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setContainerWidth(
        el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0'),
      );
    };
    measure();
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setContainerWidth(box.width);
      else measure();
    });
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

  /**
   * Go to a zoom, holding `anchor` (in the scroller's coordinates) still.
   *
   * The scroll correction is deferred a frame because it has to be applied to the
   * NEW content size: setting `scrollLeft` before React has resized the pages just
   * clamps it to the old, smaller scroll range and the correction is lost.
   */
  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const target = clampZoom(next);
    const prev = zoomRef.current;
    if (target === prev) return;
    zoomRef.current = target;

    const el = scrollRef.current;
    if (el) {
      const a = anchor ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const fixed = zoomAnchor({
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        anchorX: a.x,
        anchorY: a.y,
        ratio: target / prev,
      });
      requestAnimationFrame(() => {
        el.scrollLeft = fixed.scrollLeft;
        el.scrollTop = fixed.scrollTop;
      });
    }
    setZoom(target);
  }, []);

  // The bitmaps catch up once the zoom has stopped moving. Every change restarts
  // the clock, so a pinch redraws once, at the end, at the scale it ended on.
  useEffect(() => {
    const id = setTimeout(() => setRenderZoom(zoom), RERENDER_DELAY_MS);
    return () => clearTimeout(id);
  }, [zoom]);

  // Pinch, double tap, and ctrl+wheel (which is what a trackpad pinch arrives as).
  //
  // All three on native listeners with `passive: false`: React's own touch and
  // wheel handlers are registered passively on the root, so `preventDefault` from a
  // JSX prop is a no-op and the browser scrolls or zooms the page underneath us.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || state !== 'ready') return;

    let startDist = 0;
    let startZoom = FIT_ZOOM;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const spread = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = spread(e.touches[0], e.touches[1]);
      startZoom = zoomRef.current;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist <= 0) return;
      // Without this the scroller pans on two fingers as well, so the page runs
      // away from the gesture that is trying to scale it.
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const mid = local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      zoomTo(startZoom * (spread(a, b) / startDist), mid);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = 0;
      // A double tap toggles between fit and 2× — the gesture everyone tries on a
      // document before they look for buttons.
      const touch = e.changedTouches[0];
      if (e.touches.length > 0 || !touch) return;
      const now = Date.now();
      const near =
        Math.abs(touch.clientX - lastTapX) < DOUBLE_TAP_SLOP_PX &&
        Math.abs(touch.clientY - lastTapY) < DOUBLE_TAP_SLOP_PX;
      if (now - lastTapAt < DOUBLE_TAP_MS && near) {
        lastTapAt = 0;
        const at = local(touch.clientX, touch.clientY);
        zoomTo(zoomRef.current > FIT_ZOOM ? FIT_ZOOM : DOUBLE_TAP_ZOOM, at);
        return;
      }
      lastTapAt = now;
      lastTapX = touch.clientX;
      lastTapY = touch.clientY;
    };

    const onWheel = (e: WheelEvent) => {
      // A trackpad pinch is a wheel event with ctrlKey set. A plain wheel is
      // scrolling and is left alone.
      if (!e.ctrlKey) return;
      e.preventDefault();
      const at = local(e.clientX, e.clientY);
      zoomTo(zoomRef.current * Math.exp(-e.deltaY / 180), at);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [state, zoomTo]);

  const canOut = canZoom(zoom, -1);
  const canIn = canZoom(zoom, 1);
  const atFit = Math.abs(zoom - FIT_ZOOM) < 0.005;

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
          onClick={() => zoomTo(stepZoom(zoomRef.current, -1))}
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
          onClick={() => zoomTo(FIT_ZOOM)}
          disabled={atFit}
          aria-label={t('zoomFit')}
          className={cn(
            'inline-flex items-center gap-1.5 min-w-[92px] h-11 justify-center rounded-xl px-3 text-xs font-bold transition-colors',
            atFit ? 'text-ink-400' : 'text-ink-700 active:bg-page',
          )}
        >
          <Maximize2 className="h-3.5 w-3.5 shrink-0" />
          <span dir="ltr" className="tabular-nums">{Math.round(zoom * 100)}%</span>
        </button>

        <button
          type="button"
          onClick={() => zoomTo(stepZoom(zoomRef.current, 1))}
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
        // One finger pans, two fingers are ours. Without `pan-x pan-y` iOS can
        // claim the second finger for a scroll before our handler ever sees it.
        style={{ height: '80vh', touchAction: 'pan-x pan-y' }}
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
                renderZoom={renderZoom}
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
  renderZoom,
  scroller,
  label,
}: {
  page: PDFPageProxy;
  containerWidth: number;
  /** What the page is LAID OUT at — follows the fingers. */
  zoom: number;
  /** What the bitmap is DRAWN at — follows the fingers once they stop. */
  renderZoom: number;
  scroller: React.RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [near, setNear] = useState(false);

  const base = page.getViewport({ scale: 1 });
  // Fit the page's width to the container, then apply the user's zoom on top.
  // `containerWidth` is already the padding-free content width (measured in the
  // parent), so there is nothing left to subtract here.
  const fit = containerWidth > 0 ? containerWidth / base.width : 0;
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
    let dropped = false;

    (async () => {
      // SERIALISED, and this is the whole point of the ref. Two renders on one
      // canvas make pdf.js reject the second ("Cannot use the same canvas during
      // multiple render() operations"), and the page stays blank — which is what
      // tapping the zoom buttons twice in a row used to do. `cancel()` alone is not
      // enough: it resolves asynchronously, so the canvas is still in use when the
      // next tap arrives. Awaiting the cancellation is what frees it.
      const running = taskRef.current;
      if (running) {
        running.cancel();
        await running.promise.catch(() => {});
      }
      if (dropped || !canvasRef.current) return;

      // Draw at the device's real resolution. This used to be capped at 2, which on a
      // DPR-3 iPhone meant the bitmap was upscaled 1.5× by the compositor — an A4
      // nutrition plan is already rendered at ~53% of paper size on a 320pt screen, so
      // softening it on top of that is most of why it reads as illegible.
      //
      // 3 is kept as a sanity bound because a DPR the ladder was never sized against
      // should not be trusted blindly; `renderScale` is what actually keeps the
      // canvas inside what iOS will hand back.
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const scale = renderScale(base.width, base.height, fit * renderZoom * dpr);
      const viewport = page.getViewport({ scale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const task = page.render({ canvas, viewport });
      taskRef.current = task;
      // Cancelling a render rejects its promise; that is the normal path when zoom
      // changes mid-draw and is not an error.
      await task.promise.catch(() => {});
      if (taskRef.current === task) taskRef.current = null;
    })();

    return () => {
      dropped = true;
      taskRef.current?.cancel();
    };
  }, [page, near, fit, renderZoom, base.width, base.height]);

  // Released when the page scrolls far away, so five zoomed-in pages don't sit in
  // memory at once.
  useEffect(() => {
    if (near) return;
    taskRef.current?.cancel();
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
      {/* The bitmap is stretched to the CSS size rather than matching it, which is
          what lets the layout follow a pinch while the redraw waits for it to end:
          mid-gesture the page is briefly a scaled-up copy of itself, then it
          sharpens. Sized here rather than imperatively so it can never disagree
          with the holder. */}
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="block"
        style={{ width: cssW, height: cssH }}
      />
    </div>
  );
}
